import { Test, TestingModule } from '@nestjs/testing';
import {
  ArgumentMetadata,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ImportExercisesDto } from './dto/import-exercises.dto';

type QueryResult = { data?: any; error?: any; count?: number };

// Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola; rpc() devuelve rpcResult
const createSupabaseMock = (
  queues: Record<string, QueryResult[]> = {},
  rpcResult: QueryResult = { data: null, error: null },
) => {
  const calls: { table: string; filters: any[][] }[] = [];
  const from = jest.fn((table: string) => {
    let call: (typeof calls)[number] | null = null;
    const next = () =>
      Promise.resolve(
        queues[`${table}:select`]?.shift() ?? { data: null, error: null },
      );
    const builder: any = {};
    builder.select = jest.fn(() => {
      call = { table, filters: [] };
      calls.push(call);
      return builder;
    });
    for (const method of ['eq', 'is', 'not', 'order', 'limit', 'in']) {
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
const imported = {
  imported: 2,
  skipped: 1,
  unknown: 1,
  xpAwarded: 20,
  totalXp: 30,
};

describe('TelemetryService.importExercises (POST /telemetry/exercises/import)', () => {
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
  const linkedTutor = () => ({
    'tutor_students:select': [{ data: { id: 'link-1' } }],
    'students:select': [{ data: { age: 7 } }],
  });
  const dto = (
    overrides: Partial<ImportExercisesDto> = {},
  ): ImportExercisesDto => ({
    studentId: STUDENT_ID,
    exerciseIds: ['escritura.lo_a', 'matematicas.d_7'],
    ...overrides,
  });

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

  it('importa a nombre del hijo verificado y devuelve el resumen', async () => {
    const mock = setup(linkedTutor(), { data: imported, error: null });

    const result = await service.importExercises(USER_ID, dto());

    expect(result).toEqual({ studentId: STUDENT_ID, ...imported });
    expect(mock.rpc).toHaveBeenCalledWith('import_completed_exercises', {
      p_user_id: USER_ID,
      p_student_id: STUDENT_ID,
      p_exercise_ids: ['escritura.lo_a', 'matematicas.d_7'],
      // Spec 0001 CTX-02: la cuenta del tutor importa en el contexto del hogar
      p_context: 'hogar',
      p_institution_id: null,
    });
  });

  it('un hijo que no es del tutor responde 403 y no importa nada', async () => {
    const mock = setup({ 'tutor_students:select': [{ data: null }] });

    await expect(
      service.importExercises(USER_ID, dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('un tutor con hijos debe indicar de quién es el progreso', async () => {
    const mock = setup({
      'profiles:select': [{ data: { age: 35 } }],
      'tutor_students:select': [{ count: 2 }],
    });

    await expect(
      service.importExercises(USER_ID, dto({ studentId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('un adulto sin hijos importa a su propia cuenta', async () => {
    const mock = setup(
      {
        'profiles:select': [{ data: { age: 60 } }],
        'tutor_students:select': [{ count: 0 }],
      },
      { data: imported, error: null },
    );

    const result = await service.importExercises(
      USER_ID,
      dto({ studentId: undefined }),
    );

    expect(mock.rpc.mock.calls[0]).toMatchObject([
      'import_completed_exercises',
      { p_student_id: null },
    ]);
    expect(result.studentId).toBeNull();
  });

  it('un error de la base responde 500 sin filtrar el detalle', async () => {
    setup(linkedTutor(), {
      data: null,
      error: { message: 'REWARD_RULE_MISSING', code: 'P0001' },
    });

    const failure = service.importExercises(USER_ID, dto());

    await expect(failure).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(failure).rejects.not.toThrow(/REWARD_RULE_MISSING/);
  });
});

describe('ImportExercisesDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: ImportExercisesDto,
  };
  const messagesFor = async (body: unknown): Promise<string[]> => {
    try {
      await pipe.transform(body, metadata);
      return [];
    } catch (error) {
      return (
        (error as BadRequestException).getResponse() as { message: string[] }
      ).message;
    }
  };

  it('acepta una lista de ejercicios válidos', async () => {
    expect(
      await messagesFor({
        exerciseIds: ['escritura.lo_a', 'escritura.up_E', 'matematicas.d_7'],
      }),
    ).toEqual([]);
  });

  it.each([
    ['lista vacía', { exerciseIds: [] }],
    ['sin lista', {}],
    [
      'ejercicio con formato inválido',
      { exerciseIds: ['escritura.lo_a', 'x; drop table'] },
    ],
    [
      'ejercicios repetidos',
      { exerciseIds: ['escritura.lo_a', 'escritura.lo_a'] },
    ],
    [
      'más de 100 ejercicios',
      {
        exerciseIds: Array.from(
          { length: 101 },
          (_, i) => `matematicas.d_${i}`,
        ),
      },
    ],
    [
      'studentId que no es UUID',
      { exerciseIds: ['escritura.lo_a'], studentId: 'no' },
    ],
    ['campo de más (xp)', { exerciseIds: ['escritura.lo_a'], xp: 999 }],
  ])('rechaza %s', async (_name, body) => {
    expect((await messagesFor(body)).length).toBeGreaterThan(0);
  });
});
