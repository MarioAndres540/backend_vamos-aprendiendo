import type { SupabaseClient } from '@supabase/supabase-js';

interface QueryError {
  message: string;
}

/**
 * Estudiante de la cuenta propia de un alumno (profiles.student_id, rol 'estudiante').
 * null para las demás cuentas (tutor, adulto, profesor...).
 */
export async function findOwnStudentId(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ studentId: string | null; error: QueryError | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('student_id')
    .eq('id', userId)
    .maybeSingle();
  return {
    studentId: (data?.student_id as string | null | undefined) ?? null,
    error,
  };
}

/** Ambiente del progreso (spec 0001): hogar = cuenta de tutor o adulto; escolar = cuenta de estudiante de un colegio */
export type ProgressContext = 'hogar' | 'escolar';

/** Colegio de la matrícula activa del estudiante (a lo sumo una: uq_student_active_enrollment) */
export async function findActiveInstitutionId(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ institutionId: string | null; error: QueryError | null }> {
  const { data, error } = await supabase
    .from('student_enrollments')
    .select('institution_id')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .maybeSingle();
  return {
    institutionId: (data?.institution_id as string | null | undefined) ?? null,
    error,
  };
}

/**
 * Ambiente de la cuenta autenticada. Lo decide el backend, nunca la petición (CTX-03):
 * la cuenta propia de un alumno es escolar (con el colegio de su matrícula activa); las demás, hogar.
 */
export async function resolveAccountContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  context: ProgressContext;
  ownStudentId: string | null;
  institutionId: string | null;
  error: QueryError | null;
}> {
  const own = await findOwnStudentId(supabase, userId);
  if (own.error || !own.studentId) {
    return { context: 'hogar', ownStudentId: null, institutionId: null, error: own.error };
  }
  const institution = await findActiveInstitutionId(supabase, own.studentId);
  return {
    context: 'escolar',
    ownStudentId: own.studentId,
    institutionId: institution.institutionId,
    error: institution.error,
  };
}

/**
 * ¿La cuenta puede ver o registrar datos de este estudiante? Sí cuando es su tutor (tutor_students)
 * o cuando es la cuenta propia del alumno. Un profesor no entra por aquí: su acceso depende de sus asignaciones.
 */
export async function isStudentLinked(
  supabase: SupabaseClient,
  userId: string,
  studentId: string,
): Promise<{ linked: boolean; error: QueryError | null }> {
  // El par tutor + estudiante es único (uq_tutor_student): a lo sumo una fila
  const { data, error } = await supabase
    .from('tutor_students')
    .select('id')
    .eq('tutor_profile_id', userId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) return { linked: false, error };
  if (data) return { linked: true, error: null };

  const own = await findOwnStudentId(supabase, userId);
  return { linked: own.studentId === studentId, error: own.error };
}
