import {
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
    InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
    AssignedStudentData,
    AssignmentStudentSummary,
    AssignmentSummary,
    ExerciseStatus,
    InstitutionData,
    TeacherAssignmentData,
    TeacherDashboardData,
    TeacherStudentDetail,
} from './interfaces/teacher-dashboard.interface';
import { Role } from '../../common/enums/role.enum';
import { AssignmentScope, TeacherAccessService } from './teacher-access.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Días de actividad escolar para contar a un estudiante como activo (decisión pendiente; por defecto 7) */
export const ACTIVE_WINDOW_DAYS = 7;
/** Días de tiempo de juego que muestra el seguimiento de un estudiante */
export const APP_TIME_DAYS = 30;
const SCHOOL_CONTEXT = 'escolar';

interface SubjectRoute {
    id: string;
    name: string;
    exercises: { id: string; label: string }[];
}

interface AttemptRow {
    estudiante_id?: string;
    exercise_id: string;
    accuracy_pct?: number | string | null;
    created_at: string;
}

const round = (value: number) => Math.round(value);
const latest = (dates: (string | null | undefined)[]) =>
    dates.filter((d): d is string => Boolean(d)).sort().pop() ?? null;

interface AssignmentRow {
    id: string;
    subject_id: string;
    class_group_id: string;
}

interface GroupRow {
    id: string;
    institution_id: string;
    academic_year: number;
    grade: string;
    name: string;
}

interface EnrollmentRow {
    student_id: string;
    class_group_id: string;
}

interface StudentRow {
    id: string;
    first_name: string;
    last_name: string;
    age: number | null;
}

@Injectable()
export class TeacherService {
    private readonly logger = new Logger(TeacherService.name);

    constructor(
        private readonly supabaseService: SupabaseService,
        private readonly access: TeacherAccessService,
    ) { }

    /**
     * Dashboard del profesor: sus colegios con vínculo activo y, por cada asignación activa (grupo + materia),
     * los estudiantes con matrícula activa en ese grupo. No ve estudiantes de otros grupos ni de otros colegios,
     * aunque pertenezcan a la misma institución.
     */
    async getDashboard(profileId: string): Promise<TeacherDashboardData> {
        const supabase = this.supabaseService.getClient();

        // 1. Validar existencia y rol del profesor en 'profiles'
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, email, role')
            .eq('id', profileId)
            .single();

        if (profileError || !profile) {
            throw new NotFoundException('Perfil de profesor no encontrado');
        }
        if (profile.role !== Role.TEACHER) {
            throw new ForbiddenException('El usuario no posee permisos de Docente');
        }

        const empty: TeacherDashboardData = {
            teacher: {
                id: profile.id,
                firstName: profile.first_name || '',
                lastName: profile.last_name || '',
                email: profile.email || '',
            },
            institutions: [],
            assignments: [],
        };

        // 2. Registro docente
        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('profile_id', profileId)
            .eq('is_active', true)
            .maybeSingle();
        if (teacherError) this.fail('consultar el docente', teacherError);
        if (!teacher) return empty;

        // 3. Colegios con vínculo laboral activo
        const { data: links, error: linksError } = await supabase
            .from('teacher_institutions')
            .select('institution_id')
            .eq('teacher_id', teacher.id)
            .eq('is_active', true);
        if (linksError) this.fail('consultar los colegios', linksError);

        const institutionIds = (links ?? []).map((l) => l.institution_id as string);
        if (institutionIds.length === 0) return empty;

        const { data: institutions, error: instError } = await supabase
            .from('institutions')
            .select('id, name, code, address, phone, email')
            .in('id', institutionIds)
            .eq('is_active', true)
            .order('name', { ascending: true });
        if (instError) this.fail('consultar los colegios', instError);

        const activeInstitutions = (institutions ?? []) as InstitutionData[];
        const activeInstitutionIds = new Set(activeInstitutions.map((i) => i.id));

        // 4. Asignaciones activas y sus grupos (solo grupos activos de colegios con vínculo activo)
        const { data: assignmentRows, error: assignmentsError } = await supabase
            .from('teacher_assignments')
            .select('id, subject_id, class_group_id')
            .eq('teacher_id', teacher.id)
            .eq('is_active', true);
        if (assignmentsError) this.fail('consultar las asignaciones', assignmentsError);

        const assignments = (assignmentRows ?? []) as AssignmentRow[];
        if (assignments.length === 0) {
            return { ...empty, institutions: activeInstitutions };
        }

        const groupIds = [...new Set(assignments.map((a) => a.class_group_id))];
        const subjectIds = [...new Set(assignments.map((a) => a.subject_id))];

        const [groupsResult, subjectsResult, enrollmentsResult] = await Promise.all([
            supabase
                .from('class_groups')
                .select('id, institution_id, academic_year, grade, name')
                .in('id', groupIds)
                .eq('is_active', true),
            supabase.from('subjects').select('id, name').in('id', subjectIds),
            supabase
                .from('student_enrollments')
                .select('student_id, class_group_id')
                .in('class_group_id', groupIds)
                .eq('is_active', true),
        ]);
        if (groupsResult.error) this.fail('consultar los grupos', groupsResult.error);
        if (subjectsResult.error) this.fail('consultar las materias', subjectsResult.error);
        if (enrollmentsResult.error) this.fail('consultar las matrículas', enrollmentsResult.error);

        const groups = new Map(
            ((groupsResult.data ?? []) as GroupRow[])
                .filter((g) => activeInstitutionIds.has(g.institution_id))
                .map((g) => [g.id, g]),
        );
        const subjects = new Map(
            ((subjectsResult.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
        );
        const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];

        // 5. Datos básicos de los estudiantes matriculados y si tienen cuenta propia
        const students = await this.findStudents([...new Set(enrollments.map((e) => e.student_id))]);

        const result: TeacherAssignmentData[] = assignments
            .filter((a) => groups.has(a.class_group_id))
            .map((a) => {
                const group = groups.get(a.class_group_id) as GroupRow;
                const groupStudents = enrollments
                    .filter((e) => e.class_group_id === group.id)
                    .map((e) => students.get(e.student_id))
                    .filter((s): s is AssignedStudentData => Boolean(s))
                    .sort((x, y) => `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`, 'es'));
                return {
                    id: a.id,
                    institutionId: group.institution_id,
                    group: {
                        id: group.id,
                        name: group.name,
                        grade: group.grade,
                        academicYear: group.academic_year,
                    },
                    subject: { id: a.subject_id, name: subjects.get(a.subject_id) ?? a.subject_id },
                    totalStudents: groupStudents.length,
                    students: groupStudents,
                };
            })
            .sort((x, y) =>
                `${x.group.grade} ${x.group.name} ${x.subject.name}`.localeCompare(
                    `${y.group.grade} ${y.group.name} ${y.subject.name}`,
                    'es',
                ),
            );

        return { ...empty, institutions: activeInstitutions, assignments: result };
    }

    private async findStudents(ids: string[]): Promise<Map<string, AssignedStudentData>> {
        if (ids.length === 0) return new Map();
        const supabase = this.supabaseService.getClient();

        const [studentsResult, accountsResult] = await Promise.all([
            supabase
                .from('students')
                .select('id, first_name, last_name, age')
                .in('id', ids)
                .eq('is_active', true),
            supabase
                .from('profiles')
                .select('student_id')
                .in('student_id', ids)
                .eq('role', Role.STUDENT),
        ]);
        if (studentsResult.error) this.fail('consultar los estudiantes', studentsResult.error);
        if (accountsResult.error) this.fail('consultar las cuentas de los estudiantes', accountsResult.error);

        const withAccount = new Set(
            ((accountsResult.data ?? []) as { student_id: string }[]).map((p) => p.student_id),
        );
        return new Map(
            ((studentsResult.data ?? []) as StudentRow[]).map((s) => [
                s.id,
                {
                    id: s.id,
                    firstName: s.first_name,
                    lastName: s.last_name,
                    age: s.age ?? null,
                    hasAccount: withAccount.has(s.id),
                },
            ]),
        );
    }

    /**
     * Indicadores de una asignación (spec 0001, TSUM): matrícula, licencias, actividad reciente y dominio de la
     * materia por estudiante. Solo cuenta datos escolares del colegio del grupo y de las rutas de la materia.
     */
    async getAssignmentSummary(profileId: string, assignmentId: string): Promise<AssignmentSummary> {
        const scope = await this.access.resolveAssignment(profileId, assignmentId);
        const supabase = this.supabaseService.getClient();

        const { data: enrollments, error: enrollmentsError } = await supabase
            .from('student_enrollments')
            .select('student_id')
            .eq('class_group_id', scope.group.id)
            .eq('is_active', true);
        if (enrollmentsError) this.fail('consultar las matrículas', enrollmentsError);

        const ids = [...new Set((enrollments ?? []).map((e) => e.student_id as string))];
        const routes = (await this.subjectRoutes([scope.subject.id])).get(scope.subject.id) ?? [];
        const exerciseIds = routes.flatMap((r) => r.exercises.map((e) => e.id));
        const now = Date.now();
        const recentSince = new Date(now - ACTIVE_WINDOW_DAYS * DAY_MS).toISOString();

        const base: AssignmentSummary = {
            assignment: {
                id: scope.id,
                institution: scope.institution,
                group: scope.group,
                subject: scope.subject,
            },
            totalExercises: exerciseIds.length,
            enrolled: 0,
            withActiveLicense: 0,
            activeRecently: 0,
            activeWindowDays: ACTIVE_WINDOW_DAYS,
            averageMastery: null,
            withoutData: 0,
            students: [],
        };
        if (ids.length === 0) return base;

        const school = scope.institution.id;
        const empty = Promise.resolve({ data: [] as unknown[], error: null });
        const [students, licensesResult, completionsResult, attemptsResult, recentAttemptsResult, recentSessionsResult] =
            await Promise.all([
                this.findStudents(ids),
                supabase
                    .from('licenses')
                    .select('student_id, expires_at')
                    .in('student_id', ids)
                    .eq('origin', 'institucional')
                    .eq('institution_id', school)
                    .eq('is_active', true),
                exerciseIds.length
                    ? supabase
                        .from('exercise_completions')
                        .select('estudiante_id, exercise_id')
                        .in('estudiante_id', ids)
                        .eq('context', SCHOOL_CONTEXT)
                        .eq('institution_id', school)
                        .in('exercise_id', exerciseIds)
                    : empty,
                exerciseIds.length
                    ? supabase
                        .from('trazos')
                        .select('estudiante_id, exercise_id, created_at')
                        .in('estudiante_id', ids)
                        .eq('context', SCHOOL_CONTEXT)
                        .eq('institution_id', school)
                        .in('exercise_id', exerciseIds)
                    : empty,
                supabase
                    .from('trazos')
                    .select('estudiante_id')
                    .in('estudiante_id', ids)
                    .eq('context', SCHOOL_CONTEXT)
                    .eq('institution_id', school)
                    .gte('created_at', recentSince),
                supabase
                    .from('app_sessions')
                    .select('student_id')
                    .in('student_id', ids)
                    .eq('context', SCHOOL_CONTEXT)
                    .eq('institution_id', school)
                    .gte('started_at', recentSince),
            ]);
        if (licensesResult.error) this.fail('consultar las licencias', licensesResult.error);
        if (completionsResult.error) this.fail('consultar los ejercicios aprobados', completionsResult.error);
        if (attemptsResult.error) this.fail('consultar los intentos', attemptsResult.error);
        if (recentAttemptsResult.error) this.fail('consultar la actividad reciente', recentAttemptsResult.error);
        if (recentSessionsResult.error) this.fail('consultar las sesiones recientes', recentSessionsResult.error);

        const licensed = new Set(
            ((licensesResult.data ?? []) as { student_id: string; expires_at: string | null }[])
                .filter((l) => !l.expires_at || new Date(l.expires_at).getTime() > now)
                .map((l) => l.student_id),
        );
        const active = new Set([
            ...((recentAttemptsResult.data ?? []) as { estudiante_id: string }[]).map((r) => r.estudiante_id),
            ...((recentSessionsResult.data ?? []) as { student_id: string }[]).map((r) => r.student_id),
        ]);
        const completions = (completionsResult.data ?? []) as { estudiante_id: string; exercise_id: string }[];
        const attempts = (attemptsResult.data ?? []) as AttemptRow[];

        const rows: AssignmentStudentSummary[] = ids
            .map((id) => students.get(id))
            .filter((s): s is AssignedStudentData => Boolean(s))
            .map((s) => {
                const completed = new Set(
                    completions.filter((c) => c.estudiante_id === s.id).map((c) => c.exercise_id),
                ).size;
                const own = attempts.filter((a) => a.estudiante_id === s.id);
                const hasData = own.length > 0 || completed > 0;
                return {
                    ...s,
                    completed,
                    total: exerciseIds.length,
                    mastery: hasData && exerciseIds.length ? round((completed / exerciseIds.length) * 100) : null,
                    attempts: own.length,
                    lastActivityAt: latest(own.map((a) => a.created_at)),
                    hasData,
                };
            })
            .sort((x, y) => `${x.lastName} ${x.firstName}`.localeCompare(`${y.lastName} ${y.firstName}`, 'es'));

        const masteries = rows.filter((r) => r.mastery !== null).map((r) => r.mastery as number);
        return {
            ...base,
            enrolled: rows.length,
            withActiveLicense: rows.filter((r) => licensed.has(r.id)).length,
            activeRecently: rows.filter((r) => active.has(r.id)).length,
            averageMastery: masteries.length
                ? round(masteries.reduce((sum, m) => sum + m, 0) / masteries.length)
                : null,
            withoutData: rows.filter((r) => !r.hasData).length,
            students: rows,
        };
    }

    /**
     * Seguimiento de un estudiante (spec 0001, TPROG): datos personales y progreso escolar en cada materia que ese
     * profesor tiene en su grupo. La consulta queda registrada (TACC-04).
     */
    async getStudentDetail(
        profileId: string,
        assignmentId: string,
        studentId: string,
    ): Promise<TeacherStudentDetail> {
        const scope = await this.access.resolveAssignment(profileId, assignmentId);
        await this.access.assertStudentEnrolled(scope, studentId);
        await this.access.logStudentAccess(profileId, scope, studentId);

        const supabase = this.supabaseService.getClient();
        const school = scope.institution.id;
        const appTimeSince = new Date(Date.now() - APP_TIME_DAYS * DAY_MS).toISOString();

        const subjects = await this.groupSubjects(scope);
        const routesBySubject = await this.subjectRoutes(subjects.map((s) => s.id));
        const exerciseIds = [...routesBySubject.values()].flat().flatMap((r) => r.exercises.map((e) => e.id));

        const [studentResult, attemptsResult, completionsResult, xpResult, sessionsResult] = await Promise.all([
            supabase
                .from('students')
                .select('id, first_name, last_name, birth_date, age, document_type, document_number')
                .eq('id', studentId)
                .maybeSingle(),
            exerciseIds.length
                ? supabase
                    .from('trazos')
                    .select('exercise_id, accuracy_pct, created_at')
                    .eq('estudiante_id', studentId)
                    .eq('context', SCHOOL_CONTEXT)
                    .eq('institution_id', school)
                    .in('exercise_id', exerciseIds)
                : Promise.resolve({ data: [] as unknown[], error: null }),
            supabase
                .from('exercise_completions')
                .select('exercise_id')
                .eq('estudiante_id', studentId)
                .eq('context', SCHOOL_CONTEXT)
                .eq('institution_id', school),
            supabase
                .from('xp_ledger')
                .select('xp_amount')
                .eq('estudiante_id', studentId)
                .eq('context', SCHOOL_CONTEXT)
                .eq('institution_id', school)
                // Solo cuenta la experiencia ya cobrada en el cofre del juego
                .not('claimed_at', 'is', null),
            supabase
                .from('app_sessions')
                .select('started_at, ended_at, last_heartbeat_at')
                .eq('student_id', studentId)
                .eq('context', SCHOOL_CONTEXT)
                .eq('institution_id', school)
                .gte('started_at', appTimeSince),
        ]);
        if (studentResult.error) this.fail('consultar el estudiante', studentResult.error);
        if (attemptsResult.error) this.fail('consultar los intentos', attemptsResult.error);
        if (completionsResult.error) this.fail('consultar los ejercicios aprobados', completionsResult.error);
        if (xpResult.error) this.fail('consultar la experiencia', xpResult.error);
        if (sessionsResult.error) this.fail('consultar el tiempo de juego', sessionsResult.error);

        const student = studentResult.data;
        if (!student) this.fail('consultar el estudiante', { message: `estudiante ${studentId} sin registro` });

        const attempts = (attemptsResult.data ?? []) as AttemptRow[];
        const completed = new Set(
            ((completionsResult.data ?? []) as { exercise_id: string }[]).map((c) => c.exercise_id),
        );
        const accuracyOf = (rows: AttemptRow[]) =>
            rows
                .map((a) => (a.accuracy_pct == null ? null : Number(a.accuracy_pct)))
                .filter((v): v is number => v !== null && Number.isFinite(v));

        const subjectDetails = subjects.map((subject) => {
            const routes = (routesBySubject.get(subject.id) ?? []).map((route) => {
                const exercises = route.exercises.map((exercise) => {
                    const own = attempts.filter((a) => a.exercise_id === exercise.id);
                    const accuracies = accuracyOf(own);
                    const status: ExerciseStatus = completed.has(exercise.id)
                        ? 'completed'
                        : own.length > 0
                            ? 'in_progress'
                            : 'pending';
                    return {
                        id: exercise.id,
                        label: exercise.label,
                        status,
                        attempts: own.length,
                        bestAccuracy: accuracies.length ? Math.max(...accuracies) : null,
                    };
                });
                return {
                    id: route.id,
                    name: route.name,
                    total: exercises.length,
                    completed: exercises.filter((e) => e.status === 'completed').length,
                    inProgress: exercises.filter((e) => e.status === 'in_progress').length,
                    pending: exercises.filter((e) => e.status === 'pending').length,
                    exercises,
                };
            });

            const subjectExerciseIds = new Set(routes.flatMap((r) => r.exercises.map((e) => e.id)));
            const subjectAttempts = attempts.filter((a) => subjectExerciseIds.has(a.exercise_id));
            const accuracies = accuracyOf(subjectAttempts);

            return {
                id: subject.id,
                name: subject.name,
                averageAccuracy: accuracies.length
                    ? round(accuracies.reduce((sum, v) => sum + v, 0) / accuracies.length)
                    : null,
                lastActivityAt: latest(subjectAttempts.map((a) => a.created_at)),
                routes,
            };
        });

        const sessions = (sessionsResult.data ?? []) as {
            started_at: string;
            ended_at: string | null;
            last_heartbeat_at: string | null;
        }[];
        const seconds = sessions.reduce((sum, session) => {
            const end = session.ended_at ?? session.last_heartbeat_at;
            if (!end) return sum;
            return sum + Math.max(0, (new Date(end).getTime() - new Date(session.started_at).getTime()) / 1000);
        }, 0);

        return {
            student: {
                id: student.id,
                firstName: student.first_name,
                lastName: student.last_name,
                birthDate: student.birth_date ?? null,
                age: student.age ?? null,
                documentType: student.document_type ?? null,
                documentNumber: student.document_number ?? null,
            },
            institution: scope.institution,
            group: scope.group,
            subjects: subjectDetails,
            xp: {
                total: ((xpResult.data ?? []) as { xp_amount: number }[]).reduce(
                    (sum, row) => sum + Number(row.xp_amount),
                    0,
                ),
            },
            appTime: { days: APP_TIME_DAYS, seconds: round(seconds) },
        };
    }

    /** Materias que el profesor tiene asignadas en el grupo (TPROG-02), en orden alfabético */
    private async groupSubjects(scope: AssignmentScope): Promise<{ id: string; name: string }[]> {
        const supabase = this.supabaseService.getClient();
        const { data: assignments, error } = await supabase
            .from('teacher_assignments')
            .select('subject_id')
            .eq('teacher_id', scope.teacherId)
            .eq('class_group_id', scope.group.id)
            .eq('is_active', true);
        if (error) this.fail('consultar las materias del grupo', error);

        const ids = [...new Set((assignments ?? []).map((a) => a.subject_id as string))];
        const { data: subjects, error: subjectsError } = await supabase
            .from('subjects')
            .select('id, name')
            .in('id', ids);
        if (subjectsError) this.fail('consultar las materias', subjectsError);

        return ((subjects ?? []) as { id: string; name: string }[]).sort((a, b) =>
            a.name.localeCompare(b.name, 'es'),
        );
    }

    /** Rutas activas de cada materia (subject_routes) con sus ejercicios activos, en el orden del catálogo */
    private async subjectRoutes(subjectIds: string[]): Promise<Map<string, SubjectRoute[]>> {
        const result = new Map<string, SubjectRoute[]>();
        if (subjectIds.length === 0) return result;
        const supabase = this.supabaseService.getClient();

        const { data: links, error } = await supabase
            .from('subject_routes')
            .select('subject_id, route_id')
            .in('subject_id', subjectIds);
        if (error) this.fail('consultar las rutas de la materia', error);

        const routeIds = [...new Set((links ?? []).map((l) => l.route_id as string))];
        if (routeIds.length === 0) return result;

        const [routesResult, catalogResult] = await Promise.all([
            supabase.from('learning_routes').select('id, name, sort_order').in('id', routeIds).eq('is_active', true),
            supabase
                .from('exercise_catalog')
                .select('id, route_id, label, sort_order')
                .in('route_id', routeIds)
                .eq('is_active', true),
        ]);
        if (routesResult.error) this.fail('consultar las rutas', routesResult.error);
        if (catalogResult.error) this.fail('consultar el catálogo de ejercicios', catalogResult.error);

        const catalog = ((catalogResult.data ?? []) as {
            id: string;
            route_id: string;
            label: string;
            sort_order: number;
        }[]).sort((a, b) => a.sort_order - b.sort_order);
        const routes = ((routesResult.data ?? []) as { id: string; name: string; sort_order: number }[])
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((route) => ({
                id: route.id,
                name: route.name,
                exercises: catalog
                    .filter((e) => e.route_id === route.id)
                    .map((e) => ({ id: e.id, label: e.label })),
            }));

        for (const subjectId of subjectIds) {
            const own = new Set(
                (links ?? []).filter((l) => l.subject_id === subjectId).map((l) => l.route_id as string),
            );
            result.set(subjectId, routes.filter((r) => own.has(r.id)));
        }
        return result;
    }

    private fail(action: string, error: { message: string }): never {
        this.logger.error(`Error al ${action}: ${error.message}`);
        throw new InternalServerErrorException(
            'No pudimos cargar tu información. Intenta de nuevo.',
        );
    }
}
