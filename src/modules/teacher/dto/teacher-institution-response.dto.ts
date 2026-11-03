import { ApiProperty } from "@nestjs/swagger";

export class InstitutionResponseDto {
    @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
    id: string;

    @ApiProperty({ example: 'Colegio San José' })
    name: string;

    @ApiProperty({ example: 'DANE-101', required: false })
    code?: string;

    @ApiProperty({ example: 'Calle 10 # 5-20', required: false })
    address?: string;

    @ApiProperty({ example: 'rectoria@sanjose.edu.co', required: false })
    email?: string;
}

export class AssignedStudentResponseDto {
    @ApiProperty({ example: 'b0000000-0000-0000-0000-000000000001' })
    id: string;

    @ApiProperty({ example: 'Mateo' })
    firstName: string;

    @ApiProperty({ example: 'Gómez' })
    lastName: string;

    @ApiProperty({ example: 8, nullable: true })
    age: number | null;

    @ApiProperty({ example: true, description: 'Tiene cuenta propia de estudiante' })
    hasAccount: boolean;
}

export class TeacherAssignmentResponseDto {
    @ApiProperty({ example: 'c0000000-0000-0000-0000-000000000001' })
    id: string;

    @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
    institutionId: string;

    @ApiProperty({ example: { id: 'uuid-grupo', name: '2A', grade: '2° Primaria', academicYear: 2026 } })
    group: { id: string; name: string; grade: string; academicYear: number };

    @ApiProperty({ example: { id: 'espanol', name: 'Español' } })
    subject: { id: string; name: string };

    @ApiProperty({ example: 5 })
    totalStudents: number;

    @ApiProperty({ type: [AssignedStudentResponseDto] })
    students: AssignedStudentResponseDto[];
}

export class TeacherDashboardResponseDto {
    @ApiProperty({
        example: {
            id: 'uuid-teacher',
            firstName: 'Carlos',
            lastName: 'Pérez',
            email: 'profesor@colegio.edu.co',
        },
    })
    teacher: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };

    @ApiProperty({ type: [InstitutionResponseDto] })
    institutions: InstitutionResponseDto[];

    @ApiProperty({ type: [TeacherAssignmentResponseDto] })
    assignments: TeacherAssignmentResponseDto[];
}
