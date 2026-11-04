import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RecordExerciseDto } from './dto/record-exercise.dto';

type QueryResult = { data?: any; error?: any; count?: number };

/**
 * Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola, y rpc()
 * responde con `rpcResult`. Registra los filtros de cada consulta y los argumentos de rpc.
 */
const createSupabaseMock = (
  queues: Record<string, QueryResult[]> = {},
  rpcResult: QueryResult = { data: null, error: null },
) => {
  const calls: { table: string; op: string; filters: any[][] }[] = [];
  const from = jest.fn((table: string) => {
    let op = '';
    let call: (typeof calls)[number] | null = null;
    const next = () =>
      Promise.resolve(
        queues[`${table}:${op}`]?.shift() ?? { data: null, error: null },
      );
    const builder: any = {};
    builder.select = jest.fn(() => {
      if (!op) {
        op = 'select';
        call = { table, op, filters: [] };
        calls.push(call);
      }
      return builder;
    });
    builder.update = jest.fn((values: any) => {
      op = 'update';
      call = { table, op, filters: [['values', values]] };
      calls.push(call);
      return builder;
    });
    for (const method of [
      'eq',
      'is',
      'not',
      'gte',
      'lte',
      'order',
      'limit',
      'in',
    ]) {
      builder[method] = jest.fn((...args: any[]) => {
        call?.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.maybeSingle = jest.fn(next);
    builder.then = (onFulfilled: any, onRejected: any) =>
      next().then(onFulfilled, onRejected);
    return builder;
  });
  const rpc = jest.fn(() => Promise.resolve(rpcResult));
  return { client: { from, rpc }, calls, rpc };
};

const USER_ID = 'user-1';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

const exerciseDto = (
  overrides: Partial<RecordExerciseDto> = {},
): RecordExerciseDto =>
  ({
    exerciseId: 'escritura.lo_a',
    clientAttemptId: '22222222-2222-4222-8222-222222222222',
    studentId: STUDENT_ID,
    coverage: 0.9,
    accuracy: 0.99,
    ...overrides,
  }) as RecordExerciseDto;

const awarded = {
  attemptId: 'att-1',
  exerciseId: 'escritura.lo_a',
  passed: true,
  attemptNumber: 1,
  duplicate: false,
  alreadyCompleted: false,
  awarded: true,
  xpAwarded: 10,
  totalXp: 10,
};

describe('TelemetryService — ejercicios, XP y progreso por ruta', () => {
  let service: TelemetryService;
  let supabaseServiceMock: { getClient: jest.Mock };

  const setup = (
    queues: Record<string, QueryResult[]> = {},
    rpcResult?: QueryResult,
  ) => {
    const mock = createSupabaseMock(queues, rpcResult);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    supabaseServiceMock = { getClient: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
      ],
    }).compile();
    service = module.get(TelemetryService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('recordExercise (POST /telemetry/exercises)', () => {
    const linkedTutor = () => ({
      'tutor_students:select': [{ data: { id: 'link-1' } }],
      'students:select': [{ data: { age: 7 } }],
    });

    it('envía el intento a la función atómica con el dueño verificado y devuelve el resultado', async () => {
      const mock = setup(linkedTutor(), { data: awarded, error: null });

      const result = await service.recordExercise(
        USER_ID,
        exerciseDto({ durationSeconds: 8.4 }),
      );

      expect(result).toEqual({ studentId: STUDENT_ID, ...awarded });
      expect(mock.rpc).toHaveBeenCalledTimes(1);
      const [fn, args] = (mock.rpc.mock.calls as any[])[0];
      expect(fn).toBe('record_exercise_attempt');
      expect(args).toMatchObject({
        p_user_id: USER_ID,
        p_student_id: STUDENT_ID,
        p_exercise_id: 'escritura.lo_a',
        p_client_attempt_id: '22222222-2222-4222-8222-222222222222',
      });
      expect(args.p_payload).toMatchObject({
        coverage: 0.9,
        accuracy: 0.99,
        durationSeconds: 8.4,
      });
    });

    it('no deja que el cliente diga si aprobó: no existe un campo passed en lo que se envía a la base', async () => {
      const mock = setup(linkedTutor(), { data: awarded, error: null });

      await service.recordExercise(USER_ID, {
        ...exerciseDto(),
        passed: true,
      } as any);

      const [, args] = (mock.rpc.mock.calls as any[])[0];
      expect(Object.keys(args.p_payload)).not.toContain('passed');
      expect(Object.keys(args)).not.toContain('p_passed');
    });

    it('envía solo los puntos de los trazos y reemplaza deviations por el formato guardado', async () => {
      const mock = setup(linkedTutor(), { data: awarded, error: null });
      const stroke = {
        points: [
          { x: 0.1, y: 0.2, t: 0 },
          { x: 0.2, y: 0.3, t: 0.1 },
        ],
      };

      await service.recordExercise(
        USER_ID,
        exerciseDto({
          userStrokes: [stroke],
          expectedPath: [stroke],
          deviations: {
            alerta: 'Empezó fuera del punto 1',
            patronAtipico: true,
          },
          startPointOk: false,
          orderOk: true,
        }),
      );

      const [, args] = (mock.rpc.mock.calls as any[])[0];
      expect(args.p_payload.userStrokes).toEqual([stroke.points]);
      expect(args.p_payload.expectedPath).toEqual([stroke.points]);
      expect(args.p_payload.deviations).toEqual({
        alerta: 'Empezó fuera del punto 1',
        patron_atipico: true,
      });
      expect(args.p_payload).toMatchObject({
        startPointOk: false,
        orderOk: true,
      });
    });

    it('un hijo que no es del tutor responde 403 y no llega a la base', async () => {
      const mock = setup({ 'tutor_students:select': [{ data: null }] });

      await expect(
        service.recordExercise(USER_ID, exerciseDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mock.rpc).not.toHaveBeenCalled();
    });

    it('un tutor con hijos debe indicar cuál juega (si no, el XP quedaría en su cuenta)', async () => {
      const mock = setup({
        'profiles:select': [{ data: { age: 35 } }],
        'tutor_students:select': [{ count: 2 }],
      });

      await expect(
        service.recordExercise(USER_ID, exerciseDto({ studentId: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mock.rpc).not.toHaveBeenCalled();
    });

    it('un adulto sin hijos registra el ejercicio a su propio nombre (p_student_id nulo)', async () => {
      const mock = setup(
        {
          'profiles:select': [{ data: { age: 60 } }],
          'tutor_students:select': [{ count: 0 }],
        },
        { data: awarded, error: null },
      );

      const result = await service.recordExercise(
        USER_ID,
        exerciseDto({ studentId: undefined }),
      );

      const [, args] = (mock.rpc.mock.calls as any[])[0];
      expect(args.p_student_id).toBeNull();
      expect(args.p_user_id).toBe(USER_ID);
      expect(result.studentId).toBeNull();
    });

    it('un ejercicio inexistente o inactivo responde 404', async () => {
      setup(linkedTutor(), {
        data: null,
        error: { message: 'EXERCISE_NOT_FOUND' },
      });

      await expect(
        service.recordExercise(
          USER_ID,
          exerciseDto({ exerciseId: 'escritura.up_B' }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('otros errores de la base responden 500 sin filtrar el detalle interno', async () => {
      setup(linkedTutor(), {
        data: null,
        error: { message: 'connection reset', code: '08006' },
      });

      const failure = service.recordExercise(USER_ID, exerciseDto());

      await expect(failure).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(failure).rejects.not.toThrow(/connection reset/);
    });

    it('un reintento aprobado devuelve el resultado que decidió la base (sin XP nuevo)', async () => {
      setup(linkedTutor(), {
        data: {
          ...awarded,
          attemptNumber: 3,
          awarded: false,
          alreadyCompleted: true,
          xpAwarded: 0,
          totalXp: 10,
        },
        error: null,
      });

      const result = await service.recordExercise(USER_ID, exerciseDto());

      expect(result).toMatchObject({
        passed: true,
        awarded: false,
        alreadyCompleted: true,
        xpAwarded: 0,
        totalXp: 10,
      });
    });

    it('un ejercicio no aprobado no entrega XP', async () => {
      setup(linkedTutor(), {
        data: {
          ...awarded,
          passed: false,
          awarded: false,
          xpAwarded: 0,
          totalXp: 0,
        },
        error: null,
      });

      const result = await service.recordExercise(
        USER_ID,
        exerciseDto({ coverage: 0.5, accuracy: 0.5 }),
      );

      expect(result).toMatchObject({
        passed: false,
        awarded: false,
        xpAwarded: 0,
        totalXp: 0,
      });
    });
  });

  describe('getRouteProgress (GET /telemetry/route-progress)', () => {
    const routes = [
      { id: 'matematicas', name: 'Matemáticas', sort_order: 1 },
      { id: 'escritura', name: 'Escritura', sort_order: 2 },
    ];
    const catalog = [
      { id: 'matematicas.d_0', route_id: 'matematicas' },
      { id: 'matematicas.d_1', route_id: 'matematicas' },
      { id: 'matematicas.d_2', route_id: 'matematicas' },
      { id: 'escritura.up_A', route_id: 'escritura' },
      { id: 'escritura.lo_a', route_id: 'escritura' },
    ];
    const linked = () => ({
      'tutor_students:select': [{ data: { id: 'link-1' } }],
      'students:select': [{ data: { age: 7 } }],
    });

    it('separa completados, en progreso (con intentos sin aprobar) y pendientes por ruta', async () => {
      setup({
        ...linked(),
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [{ data: catalog }],
        'exercise_completions:select': [
          { data: [{ exercise_id: 'matematicas.d_0' }] },
        ],
        // d_0 aprobado (con dos intentos), d_1 con un intento sin aprobar
        'trazos:select': [
          {
            data: [
              { exercise_id: 'matematicas.d_0' },
              { exercise_id: 'matematicas.d_0' },
              { exercise_id: 'matematicas.d_1' },
            ],
          },
        ],
      });

      const progress = await service.getRouteProgress(USER_ID, STUDENT_ID);

      expect(progress.hasData).toBe(true);
      expect(progress.routes).toEqual([
        {
          id: 'matematicas',
          name: 'Matemáticas',
          total: 3,
          completed: 1,
          inProgress: 1,
          pending: 1,
          percentCompleted: 33,
          completedExerciseIds: ['matematicas.d_0'],
        },
        {
          id: 'escritura',
          name: 'Escritura',
          total: 2,
          completed: 0,
          inProgress: 0,
          pending: 2,
          percentCompleted: 0,
          completedExerciseIds: [],
        },
      ]);
    });

    it('cada ruta se calcula por separado', async () => {
      setup({
        ...linked(),
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [{ data: catalog }],
        'exercise_completions:select': [
          {
            data: [
              { exercise_id: 'escritura.up_A' },
              { exercise_id: 'escritura.lo_a' },
            ],
          },
        ],
        'trazos:select': [
          {
            data: [
              { exercise_id: 'escritura.up_A' },
              { exercise_id: 'escritura.lo_a' },
            ],
          },
        ],
      });

      const { routes: result } = await service.getRouteProgress(
        USER_ID,
        STUDENT_ID,
      );

      expect(result.find((r) => r.id === 'escritura')).toMatchObject({
        completed: 2,
        pending: 0,
        percentCompleted: 100,
      });
      expect(result.find((r) => r.id === 'matematicas')).toMatchObject({
        completed: 0,
        inProgress: 0,
        pending: 3,
      });
    });

    it('sin intentos ni aprobados, hasData es false: no se inventan actividades en progreso', async () => {
      setup({
        ...linked(),
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [{ data: catalog }],
        'exercise_completions:select': [{ data: [] }],
        'trazos:select': [{ data: [] }],
      });

      const progress = await service.getRouteProgress(USER_ID, STUDENT_ID);

      expect(progress.hasData).toBe(false);
      expect(
        progress.routes.every((r) => r.inProgress === 0 && r.completed === 0),
      ).toBe(true);
    });

    it('una ruta sin ejercicios activos devuelve total 0 (no se cuentan los que Unity aún no habilita)', async () => {
      setup({
        ...linked(),
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [
          { data: catalog.filter((e) => e.route_id === 'matematicas') },
        ],
        'exercise_completions:select': [{ data: [] }],
        'trazos:select': [{ data: [] }],
      });

      const { routes: result } = await service.getRouteProgress(
        USER_ID,
        STUDENT_ID,
      );

      expect(result.find((r) => r.id === 'escritura')).toMatchObject({
        total: 0,
        pending: 0,
        percentCompleted: 0,
      });
    });

    it('consulta solo los datos de ese estudiante (aprobados por owner_id e intentos por estudiante)', async () => {
      const mock = setup({
        ...linked(),
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [{ data: catalog }],
        'exercise_completions:select': [{ data: [] }],
        'trazos:select': [{ data: [] }],
      });

      await service.getRouteProgress(USER_ID, STUDENT_ID);

      const completions = mock.calls.find(
        (c) => c.table === 'exercise_completions',
      );
      expect(completions?.filters).toContainEqual([
        'eq',
        'owner_id',
        STUDENT_ID,
      ]);
      const attempts = mock.calls.find((c) => c.table === 'trazos');
      expect(attempts?.filters).toContainEqual(['eq', 'usuario_id', USER_ID]);
      expect(attempts?.filters).toContainEqual([
        'eq',
        'estudiante_id',
        STUDENT_ID,
      ]);
    });

    it('un estudiante ajeno responde 403 y no consulta ningún dato', async () => {
      const mock = setup({ 'tutor_students:select': [{ data: null }] });

      await expect(
        service.getRouteProgress(USER_ID, STUDENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        mock.calls.some(
          (c) => c.table === 'exercise_completions' || c.table === 'trazos',
        ),
      ).toBe(false);
    });

    it('un adulto consulta lo suyo: aprobados por su propia cuenta e intentos sin estudiante', async () => {
      const mock = setup({
        'profiles:select': [{ data: { age: 60 } }],
        'learning_routes:select': [{ data: routes }],
        'exercise_catalog:select': [{ data: catalog }],
        'exercise_completions:select': [{ data: [] }],
        'trazos:select': [{ data: [] }],
      });

      await service.getRouteProgress(USER_ID);

      expect(
        mock.calls.find((c) => c.table === 'exercise_completions')?.filters,
      ).toContainEqual(['eq', 'owner_id', USER_ID]);
      expect(
        mock.calls.find((c) => c.table === 'trazos')?.filters,
      ).toContainEqual(['is', 'estudiante_id', null]);
    });
  });

  describe('claimXp (POST /telemetry/xp/claim)', () => {
    const linked = () => ({
      'tutor_students:select': [{ data: { id: 'link-1' } }],
      'students:select': [{ data: { age: 7 } }],
    });

    it('marca como cobradas solo las filas por cobrar del estudiante y devuelve cuánto XP se cobró', async () => {
      const mock = setup({
        ...linked(),
        'xp_ledger:update': [
          { data: [{ xp_amount: 10 }, { xp_amount: 10 }], error: null },
        ],
      });

      const result = await service.claimXp(USER_ID, {
        studentId: STUDENT_ID,
        exerciseIds: ['matematicas.d_4', 'matematicas.d_5'],
      });

      expect(result).toEqual({
        studentId: STUDENT_ID,
        claimed: 2,
        xpClaimed: 20,
      });
      const update = mock.calls.find(
        (c: any) => c.table === 'xp_ledger' && c.op === 'update',
      );
      const filters = update.filters.map((f: any[]) => f[0]);
      expect(filters).toEqual(expect.arrayContaining(['eq', 'in', 'is']));
      expect(update.filters).toContainEqual([
        'is',
        'claimed_at',
        null,
      ]);
      expect(update.filters).toContainEqual([
        'in',
        'source_id',
        ['matematicas.d_4', 'matematicas.d_5'],
      ]);
    });

    it('un estudiante ajeno responde 403 y no toca el libro de XP', async () => {
      const mock = setup({ 'tutor_students:select': [{ data: null }] });

      await expect(
        service.claimXp(USER_ID, {
          studentId: STUDENT_ID,
          exerciseIds: ['matematicas.d_4'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        mock.calls.some((c: any) => c.table === 'xp_ledger'),
      ).toBe(false);
    });
  });

  describe('getXp (GET /telemetry/xp)', () => {
    const linked = () => ({
      'tutor_students:select': [{ data: { id: 'link-1' } }],
      'students:select': [{ data: { age: 7 } }],
    });

    it('suma el XP acumulado y devuelve las recompensas recientes con el nombre del ejercicio', async () => {
      setup({
        ...linked(),
        'xp_ledger:select': [
          {
            data: [
              {
                source_id: 'escritura.lo_a',
                xp_amount: 10,
                created_at: '2026-10-31T15:00:00Z',
                claimed_at: '2026-11-01T10:00:00Z',
              },
              {
                source_id: 'matematicas.d_7',
                xp_amount: 10,
                created_at: '2026-10-30T15:00:00Z',
                claimed_at: '2026-11-01T10:00:00Z',
              },
              {
                source_id: 'matematicas.d_8',
                xp_amount: 15,
                created_at: '2026-10-29T15:00:00Z',
                claimed_at: '2026-11-01T10:00:00Z',
              },
              // aprobado pero sin cobrar en el cofre: no cuenta en el total
              {
                source_id: 'matematicas.d_9',
                xp_amount: 10,
                created_at: '2026-11-01T09:00:00Z',
                claimed_at: null,
              },
            ],
          },
        ],
        'exercise_catalog:select': [
          {
            data: [
              { id: 'escritura.lo_a', label: 'Letra a (minúscula)' },
              { id: 'matematicas.d_7', label: 'El número 7' },
            ],
          },
        ],
      });

      const xp = await service.getXp(USER_ID, STUDENT_ID, 2);

      expect(xp.totalXp).toBe(35);
      expect(xp.rewardsCount).toBe(3);
      expect(xp.pendingXp).toBe(10);
      expect(xp.pending).toEqual([{ exerciseId: 'matematicas.d_9', xp: 10 }]);
      expect(xp.history).toEqual([
        {
          exerciseId: 'escritura.lo_a',
          label: 'Letra a (minúscula)',
          xp: 10,
          awardedAt: '2026-10-31T15:00:00Z',
        },
        {
          exerciseId: 'matematicas.d_7',
          label: 'El número 7',
          xp: 10,
          awardedAt: '2026-10-30T15:00:00Z',
        },
      ]);
    });

    it('sin recompensas el total es 0 y el historial vacío', async () => {
      setup({ ...linked(), 'xp_ledger:select': [{ data: [] }] });

      const xp = await service.getXp(USER_ID, STUDENT_ID);

      expect(xp).toEqual({
        studentId: STUDENT_ID,
        totalXp: 0,
        rewardsCount: 0,
        pendingXp: 0,
        pending: [],
        history: [],
      });
    });

    it('un estudiante ajeno responde 403 y no lee el libro de XP', async () => {
      const mock = setup({ 'tutor_students:select': [{ data: null }] });

      await expect(service.getXp(USER_ID, STUDENT_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mock.calls.some((c) => c.table === 'xp_ledger')).toBe(false);
    });
  });

  describe('getPerformance: métricas que Unity aún no envía', () => {
    it('una precisión nula no se promedia como 0: la métrica queda sin datos', async () => {
      setup({
        'profiles:select': [{ data: { age: 7 } }],
        'trazos:select': [
          {
            data: [
              {
                tipo_elemento: 'letra',
                valor_esperado: 'a',
                precision_pct: null,
                tiempo_trazo_seg: null,
                desviaciones: null,
                created_at: '2026-10-31T10:00:00Z',
              },
            ],
          },
        ],
        'game_sessions:select': [{ count: 0 }],
      });

      const performance = await service.getPerformance(USER_ID, undefined, 30);

      const letters = performance.metrics.find(
        (m) => m.key === 'letters_precision',
      );
      expect(letters).toMatchObject({ value: null, samples: 0, status: null });
    });
  });
});
