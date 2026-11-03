export interface InstitutionData {
    id: string;
    name: string;
    code?: string;
    address?: string;
    phone?: string;
    email?: string;
}

/** Estudiante de un grupo asignado. Sin documento ni datos de contacto: esos van solo en el detalle */
export interface AssignedStudentData {
    id: string;
    firstName: string;
    lastName: string;
    age: number | null;
    /** El alumno tiene cuenta propia (rol estudiante) para jugar en el colegio */
    hasAccount: boolean;
}

/** Asignación académica: un grupo de un colegio y una materia */
export interface TeacherAssignmentData {
    id: string;
    institutionId: string;
    group: {
        id: string;
        name: string;
        grade: string;
        academicYear: number;
    };
    subject: {
        id: string;
        name: string;
    };
    totalStudents: number;
    students: AssignedStudentData[];
}

export interface TeacherDashboardData {
    teacher: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
    /** Colegios con vínculo activo */
    institutions: InstitutionData[];
    /** Solo las asignaciones activas en esos colegios */
    assignments: TeacherAssignmentData[];
}

/** Indicadores de una asignación (spec 0001, TSUM). Solo datos escolares del colegio del grupo */
export interface AssignmentStudentSummary {
    id: string;
    firstName: string;
    lastName: string;
    age: number | null;
    hasAccount: boolean;
    /** Ejercicios aprobados y total de las rutas de la materia */
    completed: number;
    total: number;
    /** Aprobados / total en %. null sin datos */
    mastery: number | null;
    attempts: number;
    /** Último intento escolar en las rutas de la materia */
    lastActivityAt: string | null;
    hasData: boolean;
}

export interface AssignmentSummary {
    assignment: {
        id: string;
        institution: { id: string; name: string };
        group: { id: string; name: string; grade: string; academicYear: number };
        subject: { id: string; name: string };
    };
    totalExercises: number;
    enrolled: number;
    withActiveLicense: number;
    activeRecently: number;
    /** Días que cuentan para activeRecently */
    activeWindowDays: number;
    averageMastery: number | null;
    withoutData: number;
    students: AssignmentStudentSummary[];
}

export type ExerciseStatus = 'completed' | 'in_progress' | 'pending';

/** Seguimiento de un estudiante desde una asignación (spec 0001, TPROG) */
export interface TeacherStudentDetail {
    student: {
        id: string;
        firstName: string;
        lastName: string;
        birthDate: string | null;
        age: number | null;
        documentType: string | null;
        documentNumber: string | null;
    };
    institution: { id: string; name: string };
    group: { id: string; name: string; grade: string; academicYear: number };
    subjects: {
        id: string;
        name: string;
        averageAccuracy: number | null;
        lastActivityAt: string | null;
        routes: {
            id: string;
            name: string;
            total: number;
            completed: number;
            inProgress: number;
            pending: number;
            exercises: {
                id: string;
                label: string;
                status: ExerciseStatus;
                attempts: number;
                bestAccuracy: number | null;
            }[];
        }[];
    }[];
    xp: { total: number };
    appTime: { days: number; seconds: number };
}
