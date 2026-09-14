export interface InstitutionData {
    id: string;
    name: string;
    code?: string;
    address?: string;
    phone?: string;
    email?: string;
}

export interface StudentData {
    id: string;
    firstName: string;
    lastName: string;
    documentType?: string;
    documentNumber?: string;
    grade: string;
    birthDate?: string;
    isActive: boolean;
}

export interface TeacherDashboardData {
    teacher: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
    institution: InstitutionData | null;
    totalStudents: number;
    students: StudentData[];
}