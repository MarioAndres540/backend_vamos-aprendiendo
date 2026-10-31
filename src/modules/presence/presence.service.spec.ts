import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PresenceService, SESSION_TIMEOUT_SECONDS } from './presence.service';
import { SupabaseService } from '../supabase/supabase.service';

type QueryResult = { data?: any; error?: any; count?: number };

/**
 * Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola
 * (si la cola se vacía, responde sin datos). Registra operaciones, payloads y filtros.
 */
const createSupabaseMock = (queues: Record<string, QueryResult[]> = {}) => {
  const calls: { table: string; op: string; payload?: any; filters: any[][] }[] = [];

  const from = jest.fn((table: string) => {
    let op = '';
    let call: (typeof calls)[number] | null = null;
    const next = () => Promise.resolve(queues[`${table}:${op}`]?.shift() ?? { data: null, error: null });
    const builder: any = {};
    for (const method of ['insert', 'update', 'delete', 'select']) {
      builder[method] = jest.fn((payload?: any) => {
        if (!op) {
          op = method;
          call = { table, op, payload, filters: [] };
          calls.push(call);
        }
        return builder;
      });
    }
    for (const method of ['eq', 'is', 'not', 'lt', 'gte', 'order', 'limit', 'in']) {
      builder[method] = jest.fn((...args: any[]) => {
        call?.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.single = jest.fn(next);
    builder.maybeSingle = jest.fn(next);
    builder.then = (onFulfilled: any, onRejected: any) => next().then(onFulfilled, onRejected);
    return builder;
  });

  return { client: { from }, calls };
};

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe('PresenceService (sesiones de la app de Unity)', () => {
  let service: PresenceService;
  let supabaseServiceMock: { getClient: jest.Mock };

  const setup = (queues: Record<string, QueryResult[]> = {}) => {
    const mock = createSupabaseMock(queues);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    supabaseServiceMock = { getClient: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PresenceService, { provide: SupabaseService, useValue: supabaseServiceMock }],
    }).compile();

    service = module.get<PresenceService>(PresenceService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('startSession', () => {
    it('abre una sesión de Unity y devuelve el intervalo de latidos', async () => {
      const mock = setup({
        'app_sessions:insert': [{ data: { id: 'sesion-1', started_at: '2026-10-08T14:00:00Z' }, error: null }],
      });

      const result = await service.startSession('tutor-1', {});

      expect(result).toEqual({
        sessionId: 'sesion-1',
        startedAt: '2026-10-08T14:00:00Z',
        heartbeatIntervalSeconds: 15,
        timeoutSeconds: SESSION_TIMEOUT_SECONDS,
      });
      const insert = mock.calls.find((c) => c.table === 'app_sessions' && c.op === 'insert');
      expect(insert?.payload).toMatchObject({ user_id: 'tutor-1', client: 'unity', student_id: null });
    });

    it('rechaza un estudiante que no está vinculado al tutor', async () => {
      setup({ 'tutor_students:select': [{ data: null, error: null, count: 0 }] });

      await expect(service.startSession('tutor-1', { studentId: 'nino-ajeno' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cierra por inactividad las sesiones abiertas sin latidos usando la hora del último latido', async () => {
      const lastBeat = secondsAgo(600);
      const mock = setup({
        'app_sessions:select': [{ data: [{ id: 'vieja', last_heartbeat_at: lastBeat }], error: null }],
        'app_sessions:insert': [{ data: { id: 'nueva', started_at: new Date().toISOString() }, error: null }],
      });

      await service.startSession('tutor-1', {});

      const close = mock.calls.find((c) => c.table === 'app_sessions' && c.op === 'update');
      expect(close?.payload).toEqual({ ended_at: lastBeat, end_reason: 'timeout' });
    });
  });

  describe('heartbeat', () => {
    it('actualiza el último latido de una sesión activa', async () => {
      const mock = setup({
        'app_sessions:select': [
          { data: { id: 'sesion-1', started_at: secondsAgo(120), last_heartbeat_at: secondsAgo(10), ended_at: null }, error: null },
        ],
      });

      const result = await service.heartbeat('tutor-1', 'sesion-1');

      expect(result.sessionId).toBe('sesion-1');
      const update = mock.calls.find((c) => c.table === 'app_sessions' && c.op === 'update');
      expect(update?.payload).toHaveProperty('last_heartbeat_at');
    });

    it('responde 409 SESSION_ENDED si la sesión expiró por falta de latidos', async () => {
      const lastBeat = secondsAgo(SESSION_TIMEOUT_SECONDS + 30);
      const mock = setup({
        'app_sessions:select': [
          { data: { id: 'sesion-1', started_at: secondsAgo(600), last_heartbeat_at: lastBeat, ended_at: null }, error: null },
        ],
      });

      await expect(service.heartbeat('tutor-1', 'sesion-1')).rejects.toBeInstanceOf(ConflictException);
      const close = mock.calls.find((c) => c.table === 'app_sessions' && c.op === 'update');
      expect(close?.payload).toEqual({ ended_at: lastBeat, end_reason: 'timeout' });
    });

    it('responde 404 si la sesión no pertenece a la cuenta', async () => {
      setup({ 'app_sessions:select': [{ data: null, error: null }] });
      await expect(service.heartbeat('tutor-1', 'sesion-ajena')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('endSession', () => {
    it('cierra la sesión y devuelve su duración', async () => {
      const startedAt = secondsAgo(300);
      setup({
        'app_sessions:select': [
          { data: { id: 'sesion-1', started_at: startedAt, last_heartbeat_at: secondsAgo(5), ended_at: null }, error: null },
        ],
      });

      const result = await service.endSession('tutor-1', 'sesion-1', 'app_closed');

      expect(result.endReason).toBe('app_closed');
      expect(result.durationSeconds).toBeGreaterThanOrEqual(299);
    });

    it('es idempotente: una sesión ya cerrada no se vuelve a cerrar', async () => {
      const mock = setup({
        'app_sessions:select': [
          {
            data: { id: 'sesion-1', started_at: secondsAgo(300), last_heartbeat_at: secondsAgo(200), ended_at: secondsAgo(200), end_reason: 'timeout' },
            error: null,
          },
        ],
      });

      const result = await service.endSession('tutor-1', 'sesion-1');

      expect(result.endReason).toBe('timeout');
      expect(mock.calls.some((c) => c.op === 'update')).toBe(false);
    });
  });

  describe('getAppStatus', () => {
    it('conectado: devuelve desde cuándo y cuánto lleva, con el hijo que juega', async () => {
      const startedAt = secondsAgo(1800);
      setup({
        'app_sessions:select': [
          { data: [], error: null }, // sesiones inactivas a cerrar
          {
            data: {
              id: 'sesion-1', student_id: 'nino-1', started_at: startedAt, last_heartbeat_at: secondsAgo(5),
              ended_at: null, device_info: 'Android 14', students: { first_name: 'Matías', last_name: 'Villegas' },
            },
            error: null,
          },
          { data: null, error: null }, // última sesión cerrada
          { data: [{ started_at: startedAt, last_heartbeat_at: secondsAgo(5), ended_at: null }], error: null },
        ],
      });

      const status = await service.getAppStatus('tutor-1');

      expect(status.isOnline).toBe(true);
      expect(status.current?.startedAt).toBe(startedAt);
      expect(status.current?.durationSeconds).toBeGreaterThanOrEqual(1799);
      expect(status.current?.student).toEqual({ id: 'nino-1', firstName: 'Matías', lastName: 'Villegas' });
      expect(status.today.sessionsCount).toBe(1);
    });

    it('desconectado: devuelve cuándo se desconectó y cuánto duró la última sesión', async () => {
      const startedAt = secondsAgo(7200);
      const endedAt = secondsAgo(3600);
      setup({
        'app_sessions:select': [
          { data: [], error: null },
          { data: null, error: null },
          { data: { id: 'sesion-0', student_id: null, started_at: startedAt, ended_at: endedAt, end_reason: 'app_closed' }, error: null },
          { data: [], error: null },
        ],
      });

      const status = await service.getAppStatus('tutor-1');

      expect(status.isOnline).toBe(false);
      expect(status.current).toBeNull();
      expect(status.lastSession).toMatchObject({ endedAt, endReason: 'app_closed', durationSeconds: 3600 });
    });
  });

  describe('getHistory (pestaña Analíticas)', () => {
    // 26 oct 2026, 10:00 a. m. en Colombia
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-26T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
    afterEach(() => jest.useRealTimers());

    it('resume las sesiones del periodo y las agrupa por día en hora de Colombia', async () => {
      const mock = setup({
        'app_sessions:select': [
          { data: [], error: null }, // sesiones inactivas por cerrar
          {
            data: [
              // 8 oct 1:38 a. m. en Colombia (6:38 UTC): cuenta el 8 de octubre, no el 7
              { id: 's2', student_id: null, started_at: '2026-10-08T06:38:43Z', ended_at: '2026-10-08T06:39:25Z', end_reason: 'logout' },
              { id: 's1', student_id: 'nino-1', started_at: '2026-10-08T06:35:35Z', ended_at: '2026-10-08T06:36:41Z', end_reason: 'app_closed', students: { first_name: 'Matías', last_name: 'Villegas' } },
            ],
            error: null,
          },
        ],
      });

      const history = await service.getHistory('tutor-1', 30);

      expect(history.summary).toEqual({
        sessionsCount: 2,
        totalSeconds: 42 + 66,
        averageSeconds: 54,
        longestSeconds: 66,
        lastStartedAt: '2026-10-08T06:38:43Z',
      });
      expect(history.daily).toHaveLength(30);
      expect(history.daily[0].date).toBe('2026-09-27');
      expect(history.daily[29].date).toBe('2026-10-26');
      expect(history.daily.find((d) => d.date === '2026-10-08')).toEqual({ date: '2026-10-08', seconds: 108, sessionsCount: 2 });
      expect(history.sessions[1].student).toEqual({ id: 'nino-1', firstName: 'Matías', lastName: 'Villegas' });
      // Desde el inicio del 27 sep en Colombia (05:00 UTC)
      const query = mock.calls.filter((c) => c.table === 'app_sessions' && c.op === 'select')[1];
      expect(query.filters).toContainEqual(['gte', 'started_at', '2026-09-27T05:00:00.000Z']);
    });

    it('una sesión abierta cuenta hasta ahora', async () => {
      setup({
        'app_sessions:select': [
          { data: [], error: null },
          { data: [{ id: 's3', student_id: null, started_at: '2026-10-26T14:50:00Z', ended_at: null, end_reason: null }], error: null },
        ],
      });

      const history = await service.getHistory('tutor-1', 7);

      expect(history.sessions[0]).toMatchObject({ isOpen: true, durationSeconds: 600 });
      expect(history.daily).toHaveLength(7);
      expect(history.daily[6]).toEqual({ date: '2026-10-26', seconds: 600, sessionsCount: 1 });
    });

    it('sin sesiones devuelve el resumen en cero', async () => {
      setup({ 'app_sessions:select': [{ data: [], error: null }, { data: [], error: null }] });

      const history = await service.getHistory('tutor-1', 7);

      expect(history.summary).toEqual({ sessionsCount: 0, totalSeconds: 0, averageSeconds: 0, longestSeconds: 0, lastStartedAt: null });
      expect(history.daily.every((d) => d.seconds === 0)).toBe(true);
    });
  });
});
