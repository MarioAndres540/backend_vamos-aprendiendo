import {
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/** Asignación validada: define qué grupo, colegio y materia puede consultar el profesor */
export interface AssignmentScope {
    id: string;
    teacherId: string;
    institution: { id: string; name: string };
    group: { id: string; name: string; grade: string; academicYear: number };
    subject: { id: string; name: string };
}

const ASSIGNMENT_NOT_FOUND = 'No encontramos esta asignación entre tus grupos.';
const STUDENT_NOT_FOUND = 'No encontramos este estudiante en tu grupo.';

/**
 * Único punto de control de acceso del profesor (spec 0001, TACC). Todo se valida contra la base en cada petición
 * (no contra el token): cerrar una asignación o el vínculo con el colegio quita el acceso de inmediato.
 * Lo que no le corresponde responde 404, nunca 403, para no revelar si el grupo o el estudiante existen.
 */
@Injectable()
export class TeacherAccessService {
    private readonly logger = new Logger(TeacherAccessService.name);

    constructor(private readonly supabaseService: SupabaseService) { }

    /** TACC-01: la asignación es del profesor, está activa, su grupo también y el vínculo con el colegio sigue activo */
    async resolveAssignment(profileId: string, assignmentId: string): Promise<AssignmentScope> {
        const supabase = this.supabaseService.getClient();

        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('profile_id', profileId)
            .eq('is_active', true)
            .maybeSingle();
        if (teacherError) this.fail('consultar el docente', teacherError);
        if (!teacher) throw new NotFoundException(ASSIGNMENT_NOT_FOUND);

        const { data: assignment, error: assignmentError } = await supabase
            .from('teacher_assignments')
            .select('id, class_group_id, subject_id')
            .eq('id', assignmentId)
            .eq('teacher_id', teacher.id)
            .eq('is_active', true)
            .maybeSingle();
        if (assignmentError) this.fail('consultar la asignación', assignmentError);
        if (!assignment) throw new NotFoundException(ASSIGNMENT_NOT_FOUND);

        const { data: group, error: groupError } = await supabase
            .from('class_groups')
            .select('id, institution_id, academic_year, grade, name')
            .eq('id', assignment.class_group_id)
            .eq('is_active', true)
            .maybeSingle();
        if (groupError) this.fail('consultar el grupo', groupError);
        if (!group) throw new NotFoundException(ASSIGNMENT_NOT_FOUND);

        const [linkResult, institutionResult, subjectResult] = await Promise.all([
            supabase
                .from('teacher_institutions')
                .select('institution_id')
                .eq('teacher_id', teacher.id)
                .eq('institution_id', group.institution_id)
                .eq('is_active', true)
                .maybeSingle(),
            supabase
                .from('institutions')
                .select('id, name')
                .eq('id', group.institution_id)
                .eq('is_active', true)
                .maybeSingle(),
            supabase.from('subjects').select('id, name').eq('id', assignment.subject_id).maybeSingle(),
        ]);
        if (linkResult.error) this.fail('consultar el vínculo con el colegio', linkResult.error);
        if (institutionResult.error) this.fail('consultar el colegio', institutionResult.error);
        if (subjectResult.error) this.fail('consultar la materia', subjectResult.error);
        if (!linkResult.data || !institutionResult.data) {
            throw new NotFoundException(ASSIGNMENT_NOT_FOUND);
        }

        return {
            id: assignment.id,
            teacherId: teacher.id,
            institution: { id: institutionResult.data.id, name: institutionResult.data.name },
            group: {
                id: group.id,
                name: group.name,
                grade: group.grade,
                academicYear: group.academic_year,
            },
            subject: {
                id: assignment.subject_id,
                name: subjectResult.data?.name ?? assignment.subject_id,
            },
        };
    }

    /** TACC-02: el estudiante tiene matrícula activa en el grupo de la asignación */
    async assertStudentEnrolled(scope: AssignmentScope, studentId: string): Promise<void> {
        const { data, error } = await this.supabaseService
            .getClient()
            .from('student_enrollments')
            .select('student_id')
            .eq('student_id', studentId)
            .eq('class_group_id', scope.group.id)
            .eq('is_active', true)
            .maybeSingle();
        if (error) this.fail('consultar la matrícula', error);
        if (!data) throw new NotFoundException(STUDENT_NOT_FOUND);
    }

    /** TACC-04: deja constancia de quién consultó los datos personales de un menor. No bloquea la consulta */
    async logStudentAccess(profileId: string, scope: AssignmentScope, studentId: string): Promise<void> {
        const { error } = await this.supabaseService
            .getClient()
            .from('data_access_log')
            .insert({
                actor_profile_id: profileId,
                student_id: studentId,
                assignment_id: scope.id,
                action: 'teacher_student_detail',
            });
        if (error) {
            this.logger.warn(
                `No se pudo registrar el acceso de ${profileId} al estudiante ${studentId}: ${error.message}`,
            );
        }
    }

    private fail(action: string, error: { message: string }): never {
        this.logger.error(`Error al ${action}: ${error.message}`);
        throw new InternalServerErrorException('No pudimos cargar tu información. Intenta de nuevo.');
    }
}
