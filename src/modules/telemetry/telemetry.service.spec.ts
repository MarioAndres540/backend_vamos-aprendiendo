import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { SupabaseService } from '../supabase/supabase.service';

type QueryResult = { data?: any; error?: any; count?: number };

/**
 * Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola
 * (si la cola se vacía, responde sin datos). Registra operaciones y filtros.
 */
const createSupabaseMock = (queues: Record<string, QueryResult[]> = {}) => {
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
    for (const method of ['eq', 'is', 'gte', 'lte', 'order', 'limit']) {
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

const categories = [
  {
    id: 'atencion',
    nombre: 'Atención Sostenida',
    descripcion: 'Foco en la tarea.',
  },
  {
    id: 'logica_matematica',
    nombre: 'Sentido Numérico y Operaciones',
    descripcion: 'Sumas y restas.',
  },
];

// Rangos para 7 a 9 años (rangos_desarrollo)
const ranges7to9 = [
  {
    area: 'numeros',
    metrica: 'precision_pct',
    valor_esperado_min: 85,
    valor_esperado_max: 100,
  },
  {
    area: 'numeros',
    metrica: 'tiempo_trazo_seg',
    valor_esperado_min: 2,
    valor_esperado_max: 6,
  },
  {
    area: 'letras',
    metrica: 'precision_pct',
    valor_esperado_min: 80,
    valor_esperado_max: 100,
  },
  {
    area: 'operaciones',
    metrica: 'tiempo_trazo_seg',
    valor_esperado_min: 3,
    valor_esperado_max: 8,
  },
];

describe('TelemetryService (Actividades y Analíticas)', () => {
  let service: TelemetryService;
  let supabaseServiceMock: { getClient: jest.Mock };

  const setup = (queues: Record<string, QueryResult[]> = {}) => {
    const mock = createSupabaseMock(queues);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  // Función: cada prueba necesita colas nuevas (setup las vacía con shift)
  const linkedStudent = () => ({
    'tutor_students:select': [{ data: { id: 'link-1' }, error: null }],
    'students:select': [{ data: { age: 7 }, error: null }],
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

    service = module.get<TelemetryService>(TelemetryService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getProgress', () => {
    it('une las categorías con el progreso del hijo; las que no tienen fila quedan sin jugar', async () => {
      const mock = setup({
        ...linkedStudent(),
        'categorias_cognitivas:select': [{ data: categories, error: null }],
        'progreso_categoria:select': [
          {
            data: [
              {
                categoria_id: 'atencion',
                puntaje_inicial: '10',
                puntaje_actual: '45.5',
                meta: '100',
                nivel_actual: 2,
                updated_at: '2026-10-20T10:00:00Z',
              },
            ],
            error: null,
          },
        ],
      });

      const result = await service.getProgress('tutor-1', 'est-1');

      expect(result.categories).toEqual([
        {
          id: 'atencion',
          name: 'Atención Sostenida',
          description: 'Foco en la tarea.',
          level: 2,
          score: 45.5,
          initialScore: 10,
          goal: 100,
          played: true,
          updatedAt: '2026-10-20T10:00:00Z',
        },
        {
          id: 'logica_matematica',
          name: 'Sentido Numérico y Operaciones',
          description: 'Sumas y restas.',
          level: 1,
          score: 0,
          initialScore: 0,
          goal: 100,
          played: false,
          updatedAt: null,
        },
      ]);
      const progress = mock.calls.find((c) => c.table === 'progreso_categoria');
      expect(progress?.filters).toEqual(
        expect.arrayContaining([
          ['eq', 'usuario_id', 'tutor-1'],
          ['eq', 'estudiante_id', 'est-1'],
        ]),
      );
    });

    it('responde 403 con un estudiante de otra cuenta y no consulta el progreso', async () => {
      const mock = setup({
        'tutor_students:select': [{ data: null, error: null }],
      });

      await expect(
        service.getProgress('tutor-1', 'ajeno'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mock.calls.some((c) => c.table === 'progreso_categoria')).toBe(
        false,
      );
    });

    it('sin studentId usa el progreso propio del usuario (estudiante_id vacío)', async () => {
      const mock = setup({
        'profiles:select': [{ data: { age: 64 }, error: null }],
        'categorias_cognitivas:select': [{ data: categories, error: null }],
        'progreso_categoria:select': [{ data: [], error: null }],
      });

      const result = await service.getProgress('adulto-1');

      expect(result.studentId).toBeNull();
      expect(
        mock.calls.find((c) => c.table === 'progreso_categoria')?.filters,
      ).toContainEqual(['is', 'estudiante_id', null]);
    });
  });

  describe('getPerformance', () => {
    it('promedia trazos y operaciones y los compara con lo esperado para la edad', async () => {
      const mock = setup({
        ...linkedStudent(),
        'trazos:select': [
          {
            data: [
              {
                tipo_elemento: 'numero',
                valor_esperado: '6',
                precision_pct: 70,
                tiempo_trazo_seg: 5,
                desviaciones: {
                  alerta: 'Escribe de abajo hacia arriba y gira el 6',
                },
                created_at: '2026-10-25T10:00:00Z',
              },
              {
                tipo_elemento: 'numero',
                valor_esperado: '3',
                precision_pct: 90,
                tiempo_trazo_seg: 3,
                desviaciones: null,
                created_at: '2026-10-25T09:00:00Z',
              },
            ],
            error: null,
          },
        ],
        'operaciones_resueltas:select': [
          {
            data: [
              { tiempo_seg: 4, correcto: true },
              { tiempo_seg: 10, correcto: false },
            ],
            error: null,
          },
        ],
        'game_sessions:select': [{ data: null, error: null, count: 3 }],
        'rangos_desarrollo:select': [{ data: ranges7to9, error: null }],
      });

      const result = await service.getPerformance('tutor-1', 'est-1', 30);

      const byKey = Object.fromEntries(result.metrics.map((m) => [m.key, m]));
      expect(byKey.numbers_precision).toMatchObject({
        value: 80,
        samples: 2,
        expectedMin: 85,
        expectedMax: 100,
        status: 'below',
      });
      expect(byKey.numbers_stroke_time).toMatchObject({
        value: 4,
        status: 'within',
      });
      expect(byKey.letters_precision).toMatchObject({
        value: null,
        samples: 0,
        expectedMin: 80,
        status: null,
      });
      expect(byKey.operation_time).toMatchObject({
        value: 7,
        expectedMin: 3,
        expectedMax: 8,
        status: 'within',
      });
      expect(byKey.operations_accuracy).toMatchObject({
        value: 50,
        expectedMin: null,
        status: null,
      });
      expect(result.alerts).toEqual([
        {
          createdAt: '2026-10-25T10:00:00Z',
          element: 'numero',
          expected: '6',
          message: 'Escribe de abajo hacia arriba y gira el 6',
        },
      ]);
      expect(result).toMatchObject({ age: 7, gameSessionsCount: 3, days: 30 });
      expect(
        mock.calls.find((c) => c.table === 'rangos_desarrollo')?.filters,
      ).toEqual(
        expect.arrayContaining([
          ['lte', 'edad_min', 7],
          ['gte', 'edad_max', 7],
        ]),
      );
    });

    it('sin datos de juego devuelve los rangos esperados y valores vacíos', async () => {
      setup({
        ...linkedStudent(),
        'game_sessions:select': [{ data: null, error: null, count: 0 }],
        'rangos_desarrollo:select': [{ data: ranges7to9, error: null }],
      });

      const result = await service.getPerformance('tutor-1', 'est-1');

      expect(result.gameSessionsCount).toBe(0);
      expect(result.alerts).toEqual([]);
      expect(
        result.metrics.every((m) => m.value === null && m.samples === 0),
      ).toBe(true);
      expect(result.metrics[0]).toMatchObject({
        expectedMin: 85,
        expectedMax: 100,
      });
    });

    it('sin edad conocida no consulta rangos', async () => {
      const mock = setup({
        'profiles:select': [{ data: { age: null }, error: null }],
      });

      const result = await service.getPerformance('adulto-1');

      expect(mock.calls.some((c) => c.table === 'rangos_desarrollo')).toBe(
        false,
      );
      expect(result.metrics.every((m) => m.expectedMin === null)).toBe(true);
    });

    it('responde 403 con un estudiante de otra cuenta', async () => {
      setup({ 'tutor_students:select': [{ data: null, error: null }] });

      await expect(
        service.getPerformance('tutor-1', 'ajeno'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
