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

export class StudentResponseDto {
    @ApiProperty({ example: 'b0000000-0000-0000-0000-000000000001' })
    id: string;

    @ApiProperty({ example: 'Mateo' })
    firstName: string;

    @ApiProperty({ example: 'Gómez' })
    lastName: string;

    @ApiProperty({ example: 'Transición' })
    grade: string;

    @ApiProperty({ example: true })
    isActive: boolean;
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

    @ApiProperty({ type: InstitutionResponseDto, nullable: true })
    institution: InstitutionResponseDto | null;

    @ApiProperty({ example: 25 })
    totalStudents: number;

    @ApiProperty({ type: [StudentResponseDto] })
    students: StudentResponseDto[];
}