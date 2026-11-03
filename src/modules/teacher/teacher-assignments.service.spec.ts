import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { TeacherAccessService } from './teacher-access.service';
import { TeacherController } from './teacher.controller';
import { SupabaseService } from '../supabase/supabase.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  createInMemorySupabase,
  Row,
} from '../../common/testing/in-memory-supabase.mock-spec';

// Spec 0001 — docs/specs/0001-modulo-profesor.md (criterios TACC, TSUM y TPROG)

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const plusSeconds = (iso: string, seconds: number) =>
  new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

const SCHOOL = 'school-1';
const OTHER_SCHOOL = 'school-2';
const schoolSessionStart = daysAgo(2);

/**
 * colegio1: el profesor prof-1 tiene Español y Matemáticas en 2A. s1 y s2 están en 2A, s3 en 2B y s4 tuvo matrícula
 * en 2A pero está cerrada. s1 también juega en casa (contexto hogar): esos datos nunca deben aparecer.
 */
const fixture = (): Record<string, Row[]> => ({
  profiles: [
    { id: 'prof-1', role: 'profesor', first_name: 'Laura', last_name: 'Martínez', email: 'porfe1@email.com' },
    { id: 'prof-2', role: 'profesor', first_name: 'Julián', last_name: 'Pérez', email: 'profesor2@email.com' },
    { id: 'acc-s1', role: 'estudiante', student_id: 's1' },
  ],
  teachers: [
    { id: 't1', profile_id: 'prof-1', is_active: true },
    { id: 't2', profile_id: 'prof-2', is_active: true },
  ],
  teacher_institutions: [
    { teacher_id: 't1', institution_id: SCHOOL, is_active: true },
    { teacher_id: 't1', institution_id: OTHER_SCHOOL, is_active: false },
    { teacher_id: 't2', institution_id: SCHOOL, is_active: true },
  ],
  institutions: [
    { id: SCHOOL, name: 'colegio1', is_active: true },
    { id: OTHER_SCHOOL, name: 'colegio2', is_active: true },
  ],
  class_groups: [
    { id: 'g-2a', institution_id: SCHOOL, academic_year: 2026, grade: '2° Primaria', name: '2A', is_active: true },
    { id: 'g-2b', institution_id: SCHOOL, academic_year: 2026, grade: '2° Primaria', name: '2B', is_active: true },
    { id: 'g-old', institution_id: SCHOOL, academic_year: 2025, grade: '1° Primaria', name: '1A', is_active: false },
    { id: 'g-x', institution_id: OTHER_SCHOOL, academic_year: 2026, grade: '2° Primaria', name: '2A', is_active: true },
  ],
  subjects: [
    { id: 'espanol', name: 'Español' },
    { id: 'matematicas', name: 'Matemáticas' },
  ],
  subject_routes: [
    { subject_id: 'espanol', route_id: 'escritura' },
    { subject_id: 'matematicas', route_id: 'matematicas' },
  ],
  learning_routes: [
    { id: 'matematicas', name: 'Matemáticas', sort_order: 1, is_active: true },
    { id: 'escritura', name: 'Escritura', sort_order: 2, is_active: true },
  ],
  exercise_catalog: [
    { id: 'escritura.up_a', route_id: 'escritura', label: 'Letra A (mayúscula)', sort_order: 1, is_active: true },
    { id: 'escritura.lo_a', route_id: 'escritura', label: 'Letra a (minúscula)', sort_order: 2, is_active: true },
    { id: 'escritura.up_b', route_id: 'escritura', label: 'Letra B (mayúscula)', sort_order: 101, is_active: false },
    { id: 'matematicas.d_1', route_id: 'matematicas', label: 'El número 1', sort_order: 1, is_active: true },
  ],
  teacher_assignments: [
    { id: 'a-esp', teacher_id: 't1', class_group_id: 'g-2a', subject_id: 'espanol', is_active: true },
    { id: 'a-mat', teacher_id: 't1', class_group_id: 'g-2a', subject_id: 'matematicas', is_active: true },
    { id: 'a-closed', teacher_id: 't1', class_group_id: 'g-2b', subject_id: 'espanol', is_active: false },
    { id: 'a-old-group', teacher_id: 't1', class_group_id: 'g-old', subject_id: 'espanol', is_active: true },
    { id: 'a-other-school', teacher_id: 't1', class_group_id: 'g-x', subject_id: 'espanol', is_active: true },
    { id: 'a-prof2', teacher_id: 't2', class_group_id: 'g-2b', subject_id: 'espanol', is_active: true },
  ],
  student_enrollments: [
    { student_id: 's1', class_group_id: 'g-2a', institution_id: SCHOOL, is_active: true },
    { student_id: 's2', class_group_id: 'g-2a', institution_id: SCHOOL, is_active: true },
    { student_id: 's3', class_group_id: 'g-2b', institution_id: SCHOOL, is_active: true },
    { student_id: 's4', class_group_id: 'g-2a', institution_id: SCHOOL, is_active: false },
  ],
  students: ['s1', 's2', 's3', 's4'].map((id, i) => ({
    id,
    first_name: `Nombre${i + 1}`,
    last_name: `Apellido${i + 1}`,
    birth_date: '2018-03-14',
    age: 8,
    document_type: 'TI',
    document_number: `10999900${i + 1}`,
    is_active: true,
  })),
  licenses: [
    { student_id: 's1', origin: 'institucional', institution_id: SCHOOL, is_active: true, expires_at: null },
    { student_id: 's2', origin: 'institucional', institution_id: SCHOOL, is_active: true, expires_at: daysAgo(1) },
  ],
  trazos: [
    { estudiante_id: 's1', exercise_id: 'escritura.up_a', context: 'escolar', institution_id: SCHOOL, accuracy_pct: 80, created_at: daysAgo(3) },
    { estudiante_id: 's1', exercise_id: 'escritura.up_a', context: 'escolar', institution_id: SCHOOL, accuracy_pct: 98, created_at: daysAgo(1) },
    { estudiante_id: 's1', exercise_id: 'matematicas.d_1', context: 'escolar', institution_id: SCHOOL, accuracy_pct: 60, created_at: daysAgo(1) },
    // Hogar del mismo niño y otro colegio: no deben contar
    { estudiante_id: 's1', exercise_id: 'escritura.lo_a', context: 'hogar', institution_id: null, accuracy_pct: 99, created_at: daysAgo(0) },
    { estudiante_id: 's2', exercise_id: 'escritura.lo_a', context: 'escolar', institution_id: OTHER_SCHOOL, accuracy_pct: 99, created_at: daysAgo(0) },
  ],
  exercise_completions: [
    { estudiante_id: 's1', exercise_id: 'escritura.up_a', context: 'escolar', institution_id: SCHOOL },
    { estudiante_id: 's1', exercise_id: 'escritura.lo_a', context: 'hogar', institution_id: null },
  ],
  xp_ledger: [
    { estudiante_id: 's1', context: 'escolar', institution_id: SCHOOL, xp_amount: 10 },
    { estudiante_id: 's1', context: 'hogar', institution_id: null, xp_amount: 10 },
  ],
  app_sessions: [
    { student_id: 's1', context: 'escolar', institution_id: SCHOOL, started_at: schoolSessionStart, ended_at: plusSeconds(schoolSessionStart, 600), last_heartbeat_at: plusSeconds(schoolSessionStart, 600) },
    { student_id: 's1', context: 'hogar', institution_id: null, started_at: daysAgo(1), ended_at: plusSeconds(daysAgo(1), 900), last_heartbeat_at: plusSeconds(daysAgo(1), 900) },
    { student_id: 's2', context: 'escolar', institution_id: SCHOOL, started_at: daysAgo(10), ended_at: plusSeconds(daysAgo(10), 300), last_heartbeat_at: plusSeconds(daysAgo(10), 300) },
  ],
  data_access_log: [],
});

describe('Módulo del profesor (spec 0001)', () => {
  let service: TeacherService;
  const supabaseServiceMock = { getClient: jest.fn() };

  const useDb = (options: { failInsertsOn?: string[] } = {}) => {
    const db = createInMemorySupabase(fixture(), options);
    supabaseServiceMock.getClient.mockReturnValue(db.client);
    return db;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeacherService,
        TeacherAccessService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
      ],
    }).compile();
    service = module.get(TeacherService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('TACC — acceso por asignación', () => {
    it.each([
      ['a-closed', 'asignación cerrada'],
      ['a-old-group', 'grupo inactivo'],
      ['a-other-school', 'vínculo con el colegio inactivo'],
      ['a-prof2', 'asignación de otro profesor'],
      ['no-existe', 'asignación inexistente'],
    ])('TACC-01: %s (%s) responde 404', async (assignmentId) => {
      useDb();
      await expect(
        service.getAssignmentSummary('prof-1', assignmentId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['s3', 'de otro grupo'],
      ['s4', 'con la matrícula cerrada'],
      ['s-otro', 'inexistente'],
    ])('TACC-02: el estudiante %s (%s) responde 404', async (studentId) => {
      useDb();
      await expect(
        service.getStudentDetail('prof-1', 'a-esp', studentId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('TACC-03: el controlador solo admite el rol profesor', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, TeacherController);
      expect(roles).toEqual([Role.TEACHER]);
    });

    it('TACC-04: registra la consulta del detalle en data_access_log', async () => {
      const db = useDb();
      await service.getStudentDetail('prof-1', 'a-esp', 's1');
      expect(db.inserted.data_access_log).toEqual([
        expect.objectContaining({
          actor_profile_id: 'prof-1',
          student_id: 's1',
          assignment_id: 'a-esp',
          action: 'teacher_student_detail',
        }),
      ]);
    });

    it('TACC-04: si el registro falla, la consulta no se bloquea', async () => {
      useDb({ failInsertsOn: ['data_access_log'] });
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      expect(detail.student.id).toBe('s1');
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('TSUM — indicadores del grupo', () => {
    it('TSUM-01/02/03: matriculados, con licencia vigente y activos en 7 días', async () => {
      useDb();
      const summary = await service.getAssignmentSummary('prof-1', 'a-esp');

      expect(summary.enrolled).toBe(2);
      // s2 tiene la licencia vencida
      expect(summary.withActiveLicense).toBe(1);
      // s2 solo tiene una sesión de hace 10 días y un intento en otro colegio
      expect(summary.activeRecently).toBe(1);
    });

    it('TSUM-04: métricas por estudiante en las rutas de la materia', async () => {
      useDb();
      const summary = await service.getAssignmentSummary('prof-1', 'a-esp');
      const s1 = summary.students.find((s) => s.id === 's1');
      const s2 = summary.students.find((s) => s.id === 's2');

      // Escritura tiene 2 ejercicios activos (up_b está inactivo)
      expect(summary.totalExercises).toBe(2);
      expect(s1).toMatchObject({ completed: 1, total: 2, mastery: 50, attempts: 2, hasData: true });
      expect(s1?.lastActivityAt).toBeTruthy();
      expect(s2).toMatchObject({ completed: 0, attempts: 0, hasData: false, mastery: null, lastActivityAt: null });
    });

    it('TSUM-05: el promedio solo considera estudiantes con datos', async () => {
      useDb();
      const summary = await service.getAssignmentSummary('prof-1', 'a-esp');
      expect(summary.averageMastery).toBe(50);
      expect(summary.withoutData).toBe(1);
    });

    it('TSUM-06: no cuenta hogar, otros colegios ni otras materias', async () => {
      useDb();
      const summary = await service.getAssignmentSummary('prof-1', 'a-esp');
      const s1 = summary.students.find((s) => s.id === 's1');
      // lo_a aprobado en casa y el intento de Matemáticas no cuentan para Español escolar
      expect(s1?.completed).toBe(1);
      expect(s1?.attempts).toBe(2);
      expect(summary.assignment.subject).toEqual({ id: 'espanol', name: 'Español' });
    });

    it('TSUM-07: sin documentos ni datos de contacto', async () => {
      useDb();
      const summary = await service.getAssignmentSummary('prof-1', 'a-esp');
      expect(JSON.stringify(summary)).not.toContain('10999900');
    });
  });

  describe('TPROG — seguimiento de un estudiante', () => {
    it('TPROG-01: datos personales, colegio y grupo', async () => {
      useDb();
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      expect(detail.student).toMatchObject({
        id: 's1',
        firstName: 'Nombre1',
        lastName: 'Apellido1',
        birthDate: '2018-03-14',
        age: 8,
        documentType: 'TI',
        documentNumber: '109999001',
      });
      expect(detail.institution).toEqual({ id: SCHOOL, name: 'colegio1' });
      expect(detail.group).toMatchObject({ name: '2A', grade: '2° Primaria' });
    });

    it('TPROG-02: todas las materias que ese profesor tiene en el grupo', async () => {
      useDb();
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      expect(detail.subjects.map((s) => s.name)).toEqual(['Español', 'Matemáticas']);
    });

    it('TPROG-03: progreso por ruta y por ejercicio de cada materia', async () => {
      useDb();
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      const spanish = detail.subjects.find((s) => s.id === 'espanol');
      const math = detail.subjects.find((s) => s.id === 'matematicas');

      expect(spanish?.routes).toEqual([
        expect.objectContaining({ id: 'escritura', completed: 1, inProgress: 0, pending: 1, total: 2 }),
      ]);
      expect(spanish?.routes[0].exercises).toEqual([
        { id: 'escritura.up_a', label: 'Letra A (mayúscula)', status: 'completed', attempts: 2, bestAccuracy: 98 },
        { id: 'escritura.lo_a', label: 'Letra a (minúscula)', status: 'pending', attempts: 0, bestAccuracy: null },
      ]);
      expect(spanish?.averageAccuracy).toBe(89);
      expect(spanish?.lastActivityAt).toBeTruthy();
      expect(math?.routes[0]).toMatchObject({ completed: 0, inProgress: 1, pending: 0 });
    });

    it('TPROG-04: XP y tiempo de juego escolares', async () => {
      useDb();
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      expect(detail.xp.total).toBe(10);
      expect(detail.appTime).toEqual({ days: 30, seconds: 600 });
    });

    it('TPROG-05: los datos del hogar del mismo niño no aparecen', async () => {
      useDb();
      const detail = await service.getStudentDetail('prof-1', 'a-esp', 's1');
      const loA = detail.subjects[0].routes[0].exercises.find((e) => e.id === 'escritura.lo_a');
      expect(loA?.status).toBe('pending');
      expect(detail.xp.total).toBe(10);
      expect(detail.appTime.seconds).toBe(600);
    });
  });
});
