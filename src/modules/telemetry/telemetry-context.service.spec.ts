import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RecordExerciseDto } from './dto/record-exercise.dto';
import { TelemetryController } from './telemetry.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

// Spec 0001 — docs/specs/0001-modulo-profesor.md (criterios CTX: progreso separado entre hogar y colegio)

type QueryResult = { data?: any; error?: any };

/** Cada consulta "tabla:select" toma el siguiente resultado de su cola; registra filtros y argumentos de rpc */
const createSupabaseMock = (
  queues: Record<string, QueryResult[]> = {},
  rpcResult: QueryResult = { data: { attemptId: 'att-1' }, error: null },
) => {
  const calls: { table: string; filters: any[][] }[] = [];
  const from = jest.fn((table: string) => {
    const call = { table, filters: [] as any[][] };
    calls.push(call);
    const next = () =>
      Promise.resolve(queues[`${table}:select`]?.shift() ?? { data: null, error: null });
    const builder: any = { select: jest.fn(() => builder) };
    for (const method of ['eq', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'in']) {
      builder[method] = jest.fn((...args: any[]) => {
        call.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.maybeSingle = jest.fn(next);
    builder.then = (onFulfilled: any, onRejected: any) => next().then(onFulfilled, onRejected);
    return builder;
  });
  const rpc = jest.fn(() => Promise.resolve(rpcResult));
  return { client: { from, rpc }, calls, rpc };
};

const STUDENT_ACCOUNT = 'alumno-1';
const OWN_STUDENT = 'est-9';
const SCHOOL = 'school-1';

/** Cuenta propia de un alumno con matrícula activa en colegio1 */
const studentAccount = (): Record<string, QueryResult[]> => ({
  'profiles:select': [{ data: { age: 8, student_id: OWN_STUDENT }, error: null }],
  'student_enrollments:select': [{ data: { institution_id: SCHOOL }, error: null }],
  'students:select': [{ data: { age: 8 }, error: null }],
});

/** Tutor con el hijo vinculado */
const tutorAccount = (): Record<string, QueryResult[]> => ({
  'tutor_students:select': [{ data: { id: 'link-1' }, error: null }],
  'students:select': [{ data: { age: 8 }, error: null }],
});

const exerciseDto = (overrides: Record<string, unknown> = {}) =>
  ({
    exerciseId: 'escritura.lo_a',
    clientAttemptId: '22222222-2222-4222-8222-222222222222',
    coverage: 0.9,
    accuracy: 0.99,
    ...overrides,
  }) as RecordExerciseDto;

describe('TelemetryService — contexto hogar / escolar (spec 0001)', () => {
  let service: TelemetryService;
  const supabaseServiceMock = { getClient: jest.fn() };

  const setup = (queues: Record<string, QueryResult[]>) => {
    const mock = createSupabaseMock(queues);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  const contextFilter = (calls: { table: string; filters: any[][] }[], table: string) =>
    calls.find((c) => c.table === table)?.filters.find((f) => f[0] === 'eq' && f[1] === 'context');

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelemetryService, { provide: SupabaseService, useValue: supabaseServiceMock }],
    }).compile();
    service = module.get(TelemetryService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('CTX-01: la cuenta de un alumno registra en escolar con el colegio de su matrícula activa', async () => {
    const mock = setup(studentAccount());

    const result = await service.recordExercise(STUDENT_ACCOUNT, exerciseDto());

    expect(mock.rpc).toHaveBeenCalledWith(
      'record_exercise_attempt',
      expect.objectContaining({
        p_user_id: STUDENT_ACCOUNT,
        p_student_id: OWN_STUDENT,
        p_context: 'escolar',
        p_institution_id: SCHOOL,
      }),
    );
    expect(result.studentId).toBe(OWN_STUDENT);
  });

  it('CTX-01: la importación de la cuenta de un alumno también es escolar', async () => {
    const mock = setup(studentAccount());

    await service.importExercises(STUDENT_ACCOUNT, { exerciseIds: ['escritura.lo_a'] } as any);

    expect(mock.rpc).toHaveBeenCalledWith(
      'import_completed_exercises',
      expect.objectContaining({ p_context: 'escolar', p_institution_id: SCHOOL }),
    );
  });

  it.each(['recordExercise', 'importExercises'] as const)(
    'CTX-01: la cuenta de estudiante puede usar %s (POST /telemetry/exercises…)',
    (method) => {
      const roles = Reflect.getMetadata(ROLES_KEY, TelemetryController.prototype[method]);
      expect(roles).toContain(Role.STUDENT);
    },
  );

  it('CTX-02: la cuenta del tutor registra en hogar y sin colegio', async () => {
    const mock = setup(tutorAccount());

    await service.recordExercise('tutor-1', exerciseDto({ studentId: OWN_STUDENT }));

    expect(mock.rpc).toHaveBeenCalledWith(
      'record_exercise_attempt',
      expect.objectContaining({ p_context: 'hogar', p_institution_id: null }),
    );
  });

  it('CTX-03: la petición no puede elegir el contexto', async () => {
    const mock = setup(tutorAccount());

    await service.recordExercise(
      'tutor-1',
      exerciseDto({ studentId: OWN_STUDENT, context: 'escolar', institutionId: SCHOOL }),
    );

    expect(mock.rpc).toHaveBeenCalledWith(
      'record_exercise_attempt',
      expect.objectContaining({ p_context: 'hogar', p_institution_id: null }),
    );
  });

  it('CTX-03: un alumno no puede registrar a nombre de otro estudiante', async () => {
    const mock = setup(studentAccount());

    await expect(
      service.recordExercise(STUDENT_ACCOUNT, exerciseDto({ studentId: 'est-otro' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('CTX-04: el tutor lee solo el progreso del hogar', async () => {
    const mock = setup({
      ...tutorAccount(),
      'categorias_cognitivas:select': [{ data: [], error: null }],
      'progreso_categoria:select': [{ data: [], error: null }],
    });

    await service.getProgress('tutor-1', OWN_STUDENT);

    expect(contextFilter(mock.calls, 'progreso_categoria')).toEqual(['eq', 'context', 'hogar']);
  });

  it('CTX-04: la cuenta del alumno lee solo el progreso escolar (rutas, aprobados y XP)', async () => {
    const mock = setup({
      ...studentAccount(),
      'learning_routes:select': [{ data: [], error: null }],
      'exercise_catalog:select': [{ data: [], error: null }],
      'exercise_completions:select': [{ data: [], error: null }],
      'trazos:select': [{ data: [], error: null }],
    });

    await service.getRouteProgress(STUDENT_ACCOUNT);

    expect(contextFilter(mock.calls, 'exercise_completions')).toEqual(['eq', 'context', 'escolar']);
    expect(contextFilter(mock.calls, 'trazos')).toEqual(['eq', 'context', 'escolar']);

    const xpMock = setup({
      ...studentAccount(),
      'xp_ledger:select': [{ data: [], error: null }],
    });
    await service.getXp(STUDENT_ACCOUNT);
    expect(contextFilter(xpMock.calls, 'xp_ledger')).toEqual(['eq', 'context', 'escolar']);
  });

  it('CTX-04: el desempeño del tutor solo usa trazos, operaciones y sesiones del hogar', async () => {
    const mock = setup({
      ...tutorAccount(),
      'trazos:select': [{ data: [], error: null }],
      'operaciones_resueltas:select': [{ data: [], error: null }],
      'game_sessions:select': [{ data: [], error: null }],
      'rangos_desarrollo:select': [{ data: [], error: null }],
    });

    await service.getPerformance('tutor-1', OWN_STUDENT);

    for (const table of ['trazos', 'operaciones_resueltas', 'game_sessions']) {
      expect(contextFilter(mock.calls, table)).toEqual(['eq', 'context', 'hogar']);
    }
  });
});
