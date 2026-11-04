import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  ConsentMeta,
  ConsentType,
  buildConsentRows,
} from '../privacy/privacy.constants';
import { CreateStudentSetupDto } from './dto/create-student-setup.dto';
import { CreateChildItemDto } from '../auth/dto/register.dto';
import { findOwnStudentId } from './student-access';
import {
  AssessmentDimensionScore,
  MyStudent,
  MyStudentsResponse,
  StudentAssessmentSummary,
} from './interfaces/my-students.interface';

const ASSESSMENT_COLUMNS =
  'id, student_id, target_type, total_score, max_score, risk_level, primary_condition, recommendations, answers, created_at';

interface TutorLinkRow {
  student_id: string;
  relationship: string | null;
}

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  document_type: string | null;
  document_number: string | null;
  grade: string | null;
  age: number | null;
  birth_date: string | null;
  institution_id: string | null;
}

interface InstitutionRow {
  id: string;
  name: string;
}

interface AssessmentRow {
  id: string;
  student_id: string | null;
  target_type: StudentAssessmentSummary['targetType'];
  total_score: number;
  max_score: number;
  risk_level: StudentAssessmentSummary['riskLevel'];
  primary_condition: string | null;
  recommendations: string | null;
  answers: unknown;
  created_at: string;
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Estudiantes vinculados al tutor (tabla tutor_students) con su último formulario inicial.
   * Lo usan el dashboard del tutor, la vista de configuración y la app de Unity para saber con qué hijo se juega.
   */
  async findMine(userId: string): Promise<MyStudentsResponse> {
    const links = await this.findLinks(userId);
    const students = await this.buildStudents(
      userId,
      links,
      links.length === 1,
    );
    return { totalStudents: students.length, students };
  }

  /**
   * Un estudiante del tutor (al seleccionarlo en el dashboard). Responde 404 si no está vinculado a la cuenta.
   */
  async findOne(userId: string, studentId: string): Promise<MyStudent> {
    const links = await this.findLinks(userId);
    const link = links.find((l) => l.student_id === studentId);
    if (!link) {
      throw new NotFoundException(
        'No encontramos este estudiante en tu cuenta.',
      );
    }

    // El formulario sin estudiante solo se asigna cuando la cuenta tiene un único hijo
    const [student] = await this.buildStudents(
      userId,
      [link],
      links.length === 1,
    );
    if (!student) {
      throw new NotFoundException(
        'No encontramos este estudiante en tu cuenta.',
      );
    }
    return student;
  }

  /**
   * Agrega un hijo a la cuenta: estudiante, vínculo con el tutor, matrícula (si tiene colegio) y licencia
   * de prueba de 14 días, igual que en el registro. Si algo falla se revierte lo creado.
   * Después el frontend lo envía al formulario inicial con su studentId.
   */
  async create(
    userId: string,
    dto: CreateChildItemDto,
    consentMeta: ConsentMeta = {},
  ): Promise<MyStudent> {
    const supabase = this.supabaseService.getClient();
    const childName = `${dto.firstName} ${dto.lastName}`.trim();

    const { data: studentRecord, error: studentError } = await supabase
      .from('students')
      .insert({
        first_name: dto.firstName.trim(),
        last_name: dto.lastName.trim(),
        document_type: dto.documentType,
        document_number: dto.documentNumber.trim(),
        birth_date: dto.birthDate,
        age: dto.age,
        grade: dto.grade || null,
        institution_id: dto.institutionId || null,
        is_active: true,
      })
      .select('id')
      .single();

    if (studentError || !studentRecord) {
      return this.failCreate(userId, null, 'students', studentError, childName);
    }

    const studentId = studentRecord.id as string;

    const { error: linkError } = await supabase.from('tutor_students').insert({
      tutor_profile_id: userId,
      student_id: studentId,
      relationship: 'hijo',
      is_primary_tutor: true,
    });
    if (linkError) {
      return this.failCreate(
        userId,
        studentId,
        'tutor_students',
        linkError,
        childName,
      );
    }

    if (dto.institutionId) {
      const { error: enrollmentError } = await supabase
        .from('student_enrollments')
        .insert({
          student_id: studentId,
          institution_id: dto.institutionId,
          grade: dto.grade || '1° Primaria',
          is_active: true,
        });
      if (enrollmentError) {
        return this.failCreate(
          userId,
          studentId,
          'student_enrollments',
          enrollmentError,
          childName,
        );
      }
    }

    const { error: licenseError } = await supabase.from('licenses').insert({
      plan_type: 'trial',
      origin: 'personal',
      owner_profile_id: userId,
      student_id: studentId,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
    });
    if (licenseError) {
      return this.failCreate(
        userId,
        studentId,
        'licenses',
        licenseError,
        childName,
      );
    }

    // Ley 1581 (spec 0004, PD-CONS-03): prueba de la autorización del representante legal para este menor
    const { error: consentError } = await supabase
      .from('privacy_consents')
      .insert(
        buildConsentRows(
          userId,
          [{ type: ConsentType.MINORS_DATA, granted: true, studentId }],
          consentMeta,
        ),
      );
    if (consentError) {
      return this.failCreate(
        userId,
        studentId,
        'privacy_consents',
        consentError,
        childName,
      );
    }

    return this.findOne(userId, studentId);
  }

  /**
   * Revierte un alta incompleta y responde con un mensaje claro. El detalle técnico queda solo en el log.
   */
  private async failCreate(
    userId: string,
    studentId: string | null,
    step: string,
    error: { message?: string; code?: string } | null,
    childName: string,
  ): Promise<never> {
    this.logger.error(
      `Alta del estudiante ${childName} (tutor ${userId}) falló en "${step}": ${error?.code ?? ''} ${error?.message ?? ''}`,
    );

    if (studentId) {
      const supabase = this.supabaseService.getClient();
      // Licencias, vínculo y matrícula primero, por si las llaves foráneas no borran en cascada
      for (const table of [
        'privacy_consents',
        'licenses',
        'student_enrollments',
        'tutor_students',
      ]) {
        const { error: cleanupError } = await supabase
          .from(table)
          .delete()
          .eq('student_id', studentId);
        if (cleanupError) {
          this.logger.error(
            `Reversión: no se pudo limpiar ${table} del estudiante ${studentId}: ${cleanupError.message}`,
          );
        }
      }
      const { error: deleteError } = await supabase
        .from('students')
        .delete()
        .eq('id', studentId);
      if (deleteError) {
        this.logger.error(
          `Reversión: no se pudo eliminar el estudiante ${studentId}: ${deleteError.message}`,
        );
      }
    }

    if (error?.code === '23505') {
      throw new ConflictException(
        'Ya existe un estudiante registrado con ese número de documento.',
      );
    }
    throw new InternalServerErrorException(
      `No pudimos registrar a ${childName}. Revisa sus datos e intenta de nuevo.`,
    );
  }

  /**
   * Estudiantes de la cuenta: los hijos del tutor o, en la cuenta propia de un alumno, su propio registro.
   * Así GET /students/mine le devuelve a Unity el estudiante con el que juega un alumno de colegio.
   */
  private async findLinks(userId: string): Promise<TutorLinkRow[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('tutor_students')
      .select('student_id, relationship')
      .eq('tutor_profile_id', userId);

    if (error) {
      this.logger.error(`Error al consultar tutor_students: ${error.message}`);
      throw new InternalServerErrorException(
        'No pudimos cargar tus estudiantes. Intenta de nuevo.',
      );
    }

    if (!data?.length) {
      const own = await findOwnStudentId(
        this.supabaseService.getClient(),
        userId,
      );
      if (own.error) {
        this.logger.error(`Error al consultar el perfil: ${own.error.message}`);
        throw new InternalServerErrorException(
          'No pudimos cargar tus estudiantes. Intenta de nuevo.',
        );
      }
      if (own.studentId) {
        return [{ student_id: own.studentId, relationship: null }];
      }
    }
    return data ?? [];
  }

  /**
   * Arma la respuesta de los estudiantes indicados: datos, colegio y último formulario inicial.
   */
  private async buildStudents(
    userId: string,
    linkRows: TutorLinkRow[],
    assignUnlinkedAssessment: boolean,
  ): Promise<MyStudent[]> {
    const studentIds = linkRows.map((link) => link.student_id);
    if (studentIds.length === 0) {
      return [];
    }

    const { data: students, error: studentsError } = await this.supabaseService
      .getClient()
      .from('students')
      .select(
        'id, first_name, last_name, document_type, document_number, grade, age, birth_date, institution_id',
      )
      .in('id', studentIds)
      .eq('is_active', true)
      .order('first_name', { ascending: true });

    if (studentsError) {
      this.logger.error(
        `Error al consultar students: ${studentsError.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos cargar tus estudiantes. Intenta de nuevo.',
      );
    }

    const rows = (students ?? []) as StudentRow[];
    const [institutions, assessments] = await Promise.all([
      this.findInstitutionNames(
        rows
          .map((s) => s.institution_id)
          .filter((id): id is string => Boolean(id)),
      ),
      this.findLatestAssessments(
        userId,
        rows.map((s) => s.id),
        assignUnlinkedAssessment,
      ),
    ]);

    const relationships = new Map(
      linkRows.map((link) => [link.student_id, link.relationship]),
    );

    return rows.map((s) => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      documentType: s.document_type ?? null,
      documentNumber: s.document_number ?? null,
      grade: s.grade ?? null,
      age: s.age ?? null,
      birthDate: s.birth_date ?? null,
      relationship: relationships.get(s.id) ?? null,
      institution: s.institution_id
        ? (institutions.get(s.institution_id) ?? null)
        : null,
      latestAssessment: assessments.get(s.id) ?? null,
    }));
  }

  /**
   * Nombres de los colegios. Si la consulta falla no bloquea la respuesta: el estudiante queda sin colegio.
   */
  private async findInstitutionNames(ids: string[]) {
    const names = new Map<string, { id: string; name: string }>();
    if (ids.length === 0) return names;

    const { data, error } = await this.supabaseService
      .getClient()
      .from('institutions')
      .select('id, name')
      .in('id', [...new Set(ids)]);

    if (error) {
      this.logger.error(`Error al consultar institutions: ${error.message}`);
      return names;
    }

    for (const institution of (data ?? []) as InstitutionRow[]) {
      names.set(institution.id, { id: institution.id, name: institution.name });
    }
    return names;
  }

  /**
   * Último formulario inicial de cada estudiante. Los formularios de niños que se guardaron sin student_id
   * (flujo de registro actual) se asignan al hijo solo cuando el tutor tiene uno; con varios no se sabe de quién es.
   * Si la consulta falla no bloquea la respuesta: el estudiante queda sin formulario.
   */
  private async findLatestAssessments(
    userId: string,
    studentIds: string[],
    assignUnlinkedAssessment: boolean,
  ) {
    const latest = new Map<string, StudentAssessmentSummary>();
    if (studentIds.length === 0) return latest;

    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('initial_assessments')
      .select(ASSESSMENT_COLUMNS)
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Error al consultar initial_assessments: ${error.message}`,
      );
      return latest;
    }

    // Vienen ordenados del más reciente al más antiguo: se conserva el primero de cada estudiante
    for (const row of (data ?? []) as AssessmentRow[]) {
      if (row.student_id && !latest.has(row.student_id)) {
        latest.set(row.student_id, this.mapAssessment(row));
      }
    }

    const [onlyStudentId] = studentIds;
    if (
      assignUnlinkedAssessment &&
      studentIds.length === 1 &&
      !latest.has(onlyStudentId)
    ) {
      const { data: unlinked, error: unlinkedError } = await supabase
        .from('initial_assessments')
        .select(ASSESSMENT_COLUMNS)
        .eq('evaluator_profile_id', userId)
        .is('student_id', null)
        .eq('target_type', 'nino')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (unlinkedError) {
        this.logger.error(
          `Error al consultar initial_assessments sin estudiante: ${unlinkedError.message}`,
        );
      } else if (unlinked) {
        latest.set(onlyStudentId, this.mapAssessment(unlinked));
      }
    }

    return latest;
  }

  private mapAssessment(row: AssessmentRow): StudentAssessmentSummary {
    return {
      id: row.id,
      targetType: row.target_type,
      totalScore: row.total_score,
      maxScore: row.max_score,
      riskLevel: row.risk_level,
      primaryCondition: row.primary_condition ?? null,
      recommendations: row.recommendations ?? null,
      answers: Array.isArray(row.answers)
        ? (row.answers as AssessmentDimensionScore[])
        : [],
      createdAt: row.created_at,
    };
  }

  /**
   * Guarda o actualiza el diagnostico del estudiante en Supabase.
   * Ademas marca has_completed_setup = true en la tabla profiles.
   */
  async saveSetup(
    userId: string,
    dto: CreateStudentSetupDto,
  ): Promise<{ success: boolean }> {
    const supabase = this.supabaseService.getClient();

    // 1. Upsert en student_profiles
    const { error: upsertError } = await supabase.from('students').upsert(
      {
        user_id: userId,
        mode: dto.mode,
        super_power: dto.superPower ?? null,
        chosen_realm: dto.chosenRealm ?? null,
        self_efficacy: dto.selfEfficacy ?? null,
        play_styles: dto.playStyles ?? null,
        cognitive_goal: dto.cognitiveGoal ?? null,
        learning_style: dto.learningStyle ?? null,
        topic_interests: dto.topicInterests ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    if (upsertError) {
      throw new InternalServerErrorException(
        `Error al guardar el perfil del estudiante: ${upsertError.message}`,
      );
    }

    // 2. Marcar has_completed_setup = true en profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ has_completed_setup: true })
      .eq('id', userId);

    if (profileError) {
      throw new InternalServerErrorException(
        `Error al actualizar el estado de setup: ${profileError.message}`,
      );
    }

    return { success: true };
  }

  /**
   * Verifica si el usuario ya completo el diagnostico inicial.
   */
  async getSetupStatus(
    userId: string,
  ): Promise<{ hasCompletedSetup: boolean }> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('has_completed_setup')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return { hasCompletedSetup: false };
    }

    return { hasCompletedSetup: data.has_completed_setup === true };
  }
}
