import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { SupabaseService } from '../supabase/supabase.service';

type QueryResult = { data?: any; error?: any; count?: number };

/**
 * Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola.
 * En getMonthlyUsage la primera lectura de app_sessions es el cierre de sesiones inactivas y la segunda, las del mes.
 */
const createSupabaseMock = (queues: Record<string, QueryResult[]> = {}) => {
  const calls: {
    table: string;
    op: string;
    payload?: any;
    filters: any[][];
  }[] = [];
  const from = jest.fn((table: string) => {
    let op = '';
    let call: (typeof calls)[number] | null = null;
    const next = () =>
      Promise.resolve(
        queues[`${table}:${op}`]?.shift() ?? { data: null, error: null },
      );
    const builder: any = {};
    for (const method of ['insert', 'update', 'select']) {
      builder[method] = jest.fn((payload?: any) => {
        if (!op) {
          op = method;
          call = { table, op, payload, filters: [] };
          calls.push(call);
        }
        return builder;
      });
    }
    for (const method of [
      'eq',
      'is',
      'not',
      'lt',
      'gte',
      'or',
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
  return { client: { from }, calls };
};

const USER_ID = 'user-1';
const iso = (value: string) => new Date(value).toISOString();
const session = (
  startedAt: string,
  endedAt: string | null,
  lastHeartbeat?: string,
) => ({
  started_at: iso(startedAt),
  last_heartbeat_at: iso(lastHeartbeat ?? endedAt ?? startedAt),
  ended_at: endedAt ? iso(endedAt) : null,
});

describe('PresenceService.getMonthlyUsage (tiempo de juego del mes)', () => {
  let service: PresenceService;
  let supabaseServiceMock: { getClient: jest.Mock };

  const setup = (
    sessions: any[],
    extra: Record<string, QueryResult[]> = {},
  ) => {
    const mock = createSupabaseMock({
      'app_sessions:select': [{ data: [] }, { data: sessions }],
      ...extra,
    });
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  // Hora de Bogotá = UTC - 5
  const setNow = (utc: string) => jest.useFakeTimers({ now: new Date(utc) });

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    supabaseServiceMock = { getClient: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
      ],
    }).compile();
    service = module.get(PresenceService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('compara el mes actual con el MISMO tramo del mes anterior', async () => {
    setNow('2026-10-17T20:00:00Z'); // 17 de octubre, 3:00 p. m. en Bogotá
    setup([
      session('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z'), // 1 h este mes
      session('2026-09-05T15:00:00Z', '2026-09-05T15:30:00Z'), // 30 min dentro del tramo del 1 al 17 de septiembre
      session('2026-09-25T15:00:00Z', '2026-09-25T20:00:00Z'), // 5 h DESPUÉS del tramo: no cuenta
    ]);

    const usage = await service.getMonthlyUsage(USER_ID);

    expect(usage.timeZone).toBe('America/Bogota');
    expect(usage.elapsedDays).toBe(17);
    expect(usage.current).toMatchObject({
      from: '2026-10-01T05:00:00.000Z',
      seconds: 3600,
      sessionsCount: 1,
    });
    expect(usage.previous).toMatchObject({
      from: '2026-09-01T05:00:00.000Z',
      to: '2026-09-17T20:00:00.000Z',
      seconds: 1800,
      sessionsCount: 1,
      capped: false,
    });
    expect(usage.comparison).toEqual({
      differenceSeconds: 1800,
      percentChange: 100,
      direction: 'up',
    });
  });

  it('la disminución sale negativa', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([
      session('2026-10-05T15:00:00Z', '2026-10-05T15:30:00Z'), // 30 min
      session('2026-09-05T15:00:00Z', '2026-09-05T16:00:00Z'), // 1 h
    ]);

    const { comparison } = await service.getMonthlyUsage(USER_ID);

    expect(comparison).toEqual({
      differenceSeconds: -1800,
      percentChange: -50,
      direction: 'down',
    });
  });

  it('sin tiempo en el mes anterior no calcula porcentaje (no hay base)', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([session('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z')]);

    const { previous, comparison } = await service.getMonthlyUsage(USER_ID);

    expect(previous.seconds).toBe(0);
    expect(comparison.percentChange).toBeNull();
    expect(comparison.differenceSeconds).toBe(3600);
  });

  it('sin sesiones en ninguno de los dos meses devuelve ceros y sin porcentaje', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([]);

    const usage = await service.getMonthlyUsage(USER_ID);

    expect(usage.current.seconds).toBe(0);
    expect(usage.previous.seconds).toBe(0);
    expect(usage.comparison).toEqual({
      differenceSeconds: 0,
      percentChange: null,
      direction: 'same',
    });
  });

  it('une las sesiones que se solapan para no contar dos veces el mismo tiempo', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([
      session('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z'),
      session('2026-10-05T15:30:00Z', '2026-10-05T16:30:00Z'), // otro dispositivo a la vez: se suman 90 min, no 120
    ]);

    const { current } = await service.getMonthlyUsage(USER_ID);

    expect(current.seconds).toBe(5400);
  });

  it('una sesión que cruza la medianoche del cambio de mes se reparte entre los dos meses', async () => {
    setNow('2026-10-17T20:00:00Z');
    // 30 sep 11:00 p. m. a 1 oct 1:00 a. m. (hora de Bogotá): 1 h en septiembre (fuera del tramo del 1 al 17) y 1 h en octubre
    setup([session('2026-10-01T04:00:00Z', '2026-10-01T06:00:00Z')]);

    const { current, previous } = await service.getMonthlyUsage(USER_ID);

    expect(current.seconds).toBe(3600);
    expect(previous.seconds).toBe(0);
  });

  it('una sesión abierta con latidos recientes cuenta hasta ahora', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([session('2026-10-17T19:00:00Z', null, '2026-10-17T19:59:50Z')]);

    const { current } = await service.getMonthlyUsage(USER_ID);

    expect(current.seconds).toBe(3600);
  });

  it('una sesión abierta sin latidos recientes cuenta solo hasta su último latido (no suma tiempo inactivo)', async () => {
    setNow('2026-10-17T20:00:00Z');
    setup([session('2026-10-17T10:00:00Z', null, '2026-10-17T10:30:00Z')]);

    const { current } = await service.getMonthlyUsage(USER_ID);

    expect(current.seconds).toBe(1800);
  });

  it('a fin de mes compara contra todo el mes anterior si este es más corto (31 de marzo vs. febrero)', async () => {
    setNow('2026-03-31T17:00:00Z'); // 31 de marzo, 12:00 m. en Bogotá
    setup([
      session('2026-02-10T15:00:00Z', '2026-02-10T16:00:00Z'),
      session('2026-02-27T15:00:00Z', '2026-02-27T15:30:00Z'),
    ]);

    const { previous } = await service.getMonthlyUsage(USER_ID);

    expect(previous.from).toBe('2026-02-01T05:00:00.000Z');
    expect(previous.to).toBe('2026-03-01T05:00:00.000Z');
    expect(previous.capped).toBe(true);
    expect(previous.seconds).toBe(5400);
  });

  it('en enero el mes anterior es diciembre del año anterior', async () => {
    setNow('2027-01-10T20:00:00Z');
    setup([session('2026-12-03T15:00:00Z', '2026-12-03T16:00:00Z')]);

    const { previous, current } = await service.getMonthlyUsage(USER_ID);

    expect(current.from).toBe('2027-01-01T05:00:00.000Z');
    expect(previous.from).toBe('2026-12-01T05:00:00.000Z');
    expect(previous.seconds).toBe(3600);
  });

  it('el último instante de septiembre en Bogotá todavía es septiembre (no se corre al mes nuevo)', async () => {
    setNow('2026-10-01T04:59:00Z'); // 30 de septiembre, 11:59 p. m. en Bogotá
    setup([]);

    const usage = await service.getMonthlyUsage(USER_ID);

    expect(usage.current.from).toBe('2026-09-01T05:00:00.000Z');
    expect(usage.elapsedDays).toBe(30);
  });

  it('con studentId filtra por ese hijo; de otro tutor responde 403 y no consulta sesiones', async () => {
    setNow('2026-10-17T20:00:00Z');
    const linked = setup([], { 'tutor_students:select': [{ count: 1 }] });
    await service.getMonthlyUsage(USER_ID, 'student-1');
    const sessionsCall = linked.calls
      .filter((c) => c.table === 'app_sessions')
      .pop();
    expect(sessionsCall?.filters).toContainEqual([
      'eq',
      'student_id',
      'student-1',
    ]);
    expect(sessionsCall?.filters).toContainEqual(['eq', 'client', 'unity']);

    const foreign = setup([], { 'tutor_students:select': [{ count: 0 }] });
    await expect(
      service.getMonthlyUsage(USER_ID, 'student-ajeno'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(foreign.calls.some((c) => c.table === 'app_sessions')).toBe(false);
  });
});
