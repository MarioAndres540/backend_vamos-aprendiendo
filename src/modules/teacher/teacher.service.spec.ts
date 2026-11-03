import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { TeacherAccessService } from './teacher-access.service';
import { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, any>;

/**
 * Base en memoria con los filtros que usa el servicio (eq, in): así las pruebas comprueban de verdad
 * que el profesor solo recibe los estudiantes de sus grupos.
 */
const createDb = (tables: Record<string, Row[]>) => ({
    from: (table: string) => {
        const filters: ((row: Row) => boolean)[] = [];
        const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        const builder: any = {
            select: () => builder,
            order: () => builder,
            eq: (column: string, value: unknown) => {
                filters.push((row) => row[column] === value);
                return builder;
            },
            in: (column: string, values: unknown[]) => {
                filters.push((row) => values.includes(row[column]));
                return builder;
            },
            single: async () => {
                const [row] = rows();
                return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
            },
            maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
        };
        return builder;
    },
});

const school1 = 'school-1';
const school2 = 'school-2';

const baseTables = (): Record<string, Row[]> => ({
    profiles: [
        { id: 'prof-1', first_name: 'Andrea', last_name: 'Rojas', email: 'profesor1@email.com', role: 'profesor' },
        { id: 'tutor-1', first_name: 'Ana', last_name: 'Ruiz', email: 'tutor@email.com', role: 'usuario' },
        { id: 'acc-s1', role: 'estudiante', student_id: 's1' },
    ],
    teachers: [{ id: 't1', profile_id: 'prof-1', is_active: true }],
    teacher_institutions: [
        { teacher_id: 't1', institution_id: school1, is_active: true },
        { teacher_id: 't1', institution_id: school2, is_active: false },
    ],
    institutions: [
        { id: school1, name: 'colegio1', is_active: true },
        { id: school2, name: 'colegio2', is_active: true },
    ],
    teacher_assignments: [
        { id: 'a-2a', teacher_id: 't1', class_group_id: 'g-2a', subject_id: 'espanol', is_active: true },
        { id: 'a-old', teacher_id: 't1', class_group_id: 'g-2b', subject_id: 'espanol', is_active: false },
        { id: 'a-school2', teacher_id: 't1', class_group_id: 'g-x', subject_id: 'espanol', is_active: true },
    ],
    class_groups: [
        { id: 'g-2a', institution_id: school1, academic_year: 2026, grade: '2° Primaria', name: '2A', is_active: true },
        { id: 'g-2b', institution_id: school1, academic_year: 2026, grade: '2° Primaria', name: '2B', is_active: true },
        { id: 'g-x', institution_id: school2, academic_year: 2026, grade: '2° Primaria', name: '2A', is_active: true },
    ],
    subjects: [{ id: 'espanol', name: 'Español' }],
    student_enrollments: [
        { student_id: 's1', class_group_id: 'g-2a', is_active: true },
        { student_id: 's2', class_group_id: 'g-2a', is_active: true },
        { student_id: 's3', class_group_id: 'g-2b', is_active: true },
        { student_id: 's4', class_group_id: 'g-2a', is_active: false },
        { student_id: 's5', class_group_id: 'g-x', is_active: true },
    ],
    students: ['s1', 's2', 's3', 's4', 's5'].map((id, i) => ({
        id,
        first_name: `Nombre${i + 1}`,
        last_name: `Apellido${i + 1}`,
        age: 8,
        document_number: `10999900${i + 1}`,
        is_active: true,
    })),
});

describe('TeacherService', () => {
    let service: TeacherService;
    const mockSupabaseService = { getClient: jest.fn() };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TeacherService,
                TeacherAccessService,
                { provide: SupabaseService, useValue: mockSupabaseService },
            ],
        }).compile();

        service = module.get<TeacherService>(TeacherService);
    });

    it('muestra solo los estudiantes matriculados en sus grupos asignados', async () => {
        mockSupabaseService.getClient.mockReturnValue(createDb(baseTables()));

        const result = await service.getDashboard('prof-1');

        expect(result.institutions.map((i) => i.name)).toEqual(['colegio1']);
        expect(result.assignments).toHaveLength(1);
        const [assignment] = result.assignments;
        expect(assignment.group.name).toBe('2A');
        expect(assignment.subject).toEqual({ id: 'espanol', name: 'Español' });
        // s3 es de 2B (asignación cerrada), s4 tiene la matrícula cerrada y s5 es de un colegio sin vínculo activo
        expect(assignment.students.map((s) => s.id)).toEqual(['s1', 's2']);
        expect(assignment.totalStudents).toBe(2);
    });

    it('no expone documentos y marca qué estudiantes tienen cuenta propia', async () => {
        mockSupabaseService.getClient.mockReturnValue(createDb(baseTables()));

        const [assignment] = (await service.getDashboard('prof-1')).assignments;

        expect(assignment.students[0]).toEqual({
            id: 's1',
            firstName: 'Nombre1',
            lastName: 'Apellido1',
            age: 8,
            hasAccount: true,
        });
        expect(assignment.students[1].hasAccount).toBe(false);
        expect(JSON.stringify(assignment)).not.toContain('10999900');
    });

    it('sin vínculo activo con ningún colegio no ve asignaciones', async () => {
        const tables = baseTables();
        tables.teacher_institutions.forEach((link) => (link.is_active = false));
        mockSupabaseService.getClient.mockReturnValue(createDb(tables));

        const result = await service.getDashboard('prof-1');

        expect(result.institutions).toEqual([]);
        expect(result.assignments).toEqual([]);
    });

    it('sin registro docente devuelve el dashboard vacío', async () => {
        const tables = baseTables();
        tables.teachers = [];
        mockSupabaseService.getClient.mockReturnValue(createDb(tables));

        const result = await service.getDashboard('prof-1');

        expect(result.teacher.email).toBe('profesor1@email.com');
        expect(result.assignments).toEqual([]);
    });

    it('rechaza a un usuario que no es profesor', async () => {
        mockSupabaseService.getClient.mockReturnValue(createDb(baseTables()));

        await expect(service.getDashboard('tutor-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('responde 404 si el perfil no existe', async () => {
        mockSupabaseService.getClient.mockReturnValue(createDb(baseTables()));

        await expect(service.getDashboard('no-existe')).rejects.toBeInstanceOf(NotFoundException);
    });
});
