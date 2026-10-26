import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType } from '../auth/dto/register.dto';
import { StudentsService } from './students.service';
import { SupabaseService } from '../supabase/supabase.service';

type QueryResult = { data?: any; error?: any };

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
    for (const method of ['insert', 'update', 'upsert', 'delete', 'select']) {
      builder[method] = jest.fn(() => {
        if (!op) {
          op = method;
          call = { table, op, filters: [] };
          calls.push(call);
        }
        return builder;
      });
    }
    for (const method of ['eq', 'is', 'in', 'order', 'limit']) {
      builder[method] = jest.fn((...args: any[]) => {
        call?.filters.push([method, ...args]);
        return builder;
      });
    }
    builder.single = jest.fn(next);
    builder.maybeSingle = jest.fn(next);
    builder.then = (onFulfilled: any, onRejected: any) =>
      next().then(onFulfilled, onRejected);
    return builder;
  });

  return { client: { from }, calls };
};

const matias = {
  id: 'est-1',
  first_name: 'matias',
  last_name: 'villegas ceballos',
  grade: '2° Primaria',
  age: 7,
  birth_date: '2019-02-01',
  institution_id: '11111111-1111-1111-1111-111111111111',
};

const assessmentRow = (overrides: Record<string, any> = {}) => ({
  id: 'eval-1',
  student_id: null,
  target_type: 'nino',
  total_score: 23,
  max_score: 40,
  risk_level: 'moderado',
  primary_condition: 'discalculia',
  recommendations: 'Refuerzo guiado',
  answers: [{ questionId: 5, dimension: 'tdah_atencion', score: 4 }],
  created_at: '2026-10-07T05:55:49Z',
  ...overrides,
});

describe('StudentsService.findMine (hijos del tutor)', () => {
  let service: StudentsService;
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
      providers: [
        StudentsService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('devuelve una lista vacía si la cuenta no tiene estudiantes vinculados', async () => {
    const mock = setup({
      'tutor_students:select': [{ data: [], error: null }],
    });

    await expect(service.findMine('tutor-1')).resolves.toEqual({
      totalStudents: 0,
      students: [],
    });
    expect(mock.calls.map((c) => c.table)).toEqual(['tutor_students']);
  });

  it('devuelve el hijo con su colegio y le asigna el formulario de niños guardado sin estudiante', async () => {
    const mock = setup({
      'tutor_students:select': [
        { data: [{ student_id: 'est-1', relationship: 'hijo' }], error: null },
      ],
      'students:select': [{ data: [matias], error: null }],
      'institutions:select': [
        {
          data: [{ id: matias.institution_id, name: 'Colegio Distrital' }],
          error: null,
        },
      ],
      'initial_assessments:select': [
        { data: [], error: null },
        { data: assessmentRow(), error: null },
      ],
    });

    const result = await service.findMine('tutor-1');

    expect(result.totalStudents).toBe(1);
    expect(result.students[0]).toMatchObject({
      id: 'est-1',
      firstName: 'matias',
      grade: '2° Primaria',
      age: 7,
      relationship: 'hijo',
      institution: { id: matias.institution_id, name: 'Colegio Distrital' },
      latestAssessment: {
        id: 'eval-1',
        riskLevel: 'moderado',
        primaryCondition: 'discalculia',
      },
    });
    const fallback = mock.calls.filter(
      (c) => c.table === 'initial_assessments',
    )[1];
    expect(fallback.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'evaluator_profile_id', 'tutor-1'],
        ['is', 'student_id', null],
        ['eq', 'target_type', 'nino'],
      ]),
    );
  });

  it('usa el formulario asociado al estudiante y conserva solo el más reciente', async () => {
    const mock = setup({
      'tutor_students:select': [
        { data: [{ student_id: 'est-1', relationship: 'hijo' }], error: null },
      ],
      'students:select': [
        { data: [{ ...matias, institution_id: null }], error: null },
      ],
      'initial_assessments:select': [
        {
          data: [
            assessmentRow({
              id: 'eval-nuevo',
              student_id: 'est-1',
              risk_level: 'bajo',
            }),
            assessmentRow({ id: 'eval-viejo', student_id: 'est-1' }),
          ],
          error: null,
        },
      ],
    });

    const result = await service.findMine('tutor-1');

    expect(result.students[0].institution).toBeNull();
    expect(result.students[0].latestAssessment).toMatchObject({
      id: 'eval-nuevo',
      riskLevel: 'bajo',
    });
    expect(
      mock.calls.filter((c) => c.table === 'initial_assessments'),
    ).toHaveLength(1);
  });

  it('con varios hijos no asigna formularios sin estudiante', async () => {
    const mock = setup({
      'tutor_students:select': [
        {
          data: [
            { student_id: 'est-1', relationship: 'hijo' },
            { student_id: 'est-2', relationship: 'hija' },
          ],
          error: null,
        },
      ],
      'students:select': [
        {
          data: [
            matias,
            {
              ...matias,
              id: 'est-2',
              first_name: 'sara',
              institution_id: null,
            },
          ],
          error: null,
        },
      ],
      'initial_assessments:select': [{ data: [], error: null }],
    });

    const result = await service.findMine('tutor-1');

    expect(result.totalStudents).toBe(2);
    expect(result.students.every((s) => s.latestAssessment === null)).toBe(
      true,
    );
    expect(result.students[1].relationship).toBe('hija');
    expect(
      mock.calls.filter((c) => c.table === 'initial_assessments'),
    ).toHaveLength(1);
  });

  it('si fallan colegios o formularios responde igual, sin esos datos', async () => {
    setup({
      'tutor_students:select': [
        { data: [{ student_id: 'est-1', relationship: 'hijo' }], error: null },
      ],
      'students:select': [{ data: [matias], error: null }],
      'institutions:select': [{ data: null, error: { message: 'timeout' } }],
      'initial_assessments:select': [
        { data: null, error: { message: 'timeout' } },
      ],
    });

    const result = await service.findMine('tutor-1');

    expect(result.students[0]).toMatchObject({
      id: 'est-1',
      institution: null,
      latestAssessment: null,
    });
  });

  it('responde 500 con un mensaje genérico si falla la consulta de vínculos', async () => {
    setup({
      'tutor_students:select': [
        { data: null, error: { message: 'relation does not exist' } },
      ],
    });

    const promise = service.findMine('tutor-1');
    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toThrow(
      'No pudimos cargar tus estudiantes. Intenta de nuevo.',
    );
  });

  it('responde 500 si falla la consulta de estudiantes', async () => {
    setup({
      'tutor_students:select': [
        { data: [{ student_id: 'est-1', relationship: 'hijo' }], error: null },
      ],
      'students:select': [
        { data: null, error: { message: 'permission denied' } },
      ],
    });

    await expect(service.findMine('tutor-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  describe('findOne (hijo seleccionado en el dashboard)', () => {
    it('responde 404 si el estudiante no está vinculado a la cuenta', async () => {
      const mock = setup({
        'tutor_students:select': [
          {
            data: [{ student_id: 'est-1', relationship: 'hijo' }],
            error: null,
          },
        ],
      });

      await expect(service.findOne('tutor-1', 'ajeno')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mock.calls.map((c) => c.table)).toEqual(['tutor_students']);
    });

    it('devuelve el hijo con su documento; con varios hijos no asigna formularios sin estudiante', async () => {
      const mock = setup({
        'tutor_students:select': [
          {
            data: [
              { student_id: 'est-1', relationship: 'hijo' },
              { student_id: 'est-2', relationship: 'hija' },
            ],
            error: null,
          },
        ],
        'students:select': [
          {
            data: [
              {
                ...matias,
                id: 'est-2',
                first_name: 'sara',
                document_type: 'RC',
                document_number: '1100',
                institution_id: null,
              },
            ],
            error: null,
          },
        ],
        'initial_assessments:select': [{ data: [], error: null }],
      });

      const student = await service.findOne('tutor-1', 'est-2');

      expect(student).toMatchObject({
        id: 'est-2',
        firstName: 'sara',
        documentType: 'RC',
        documentNumber: '1100',
        relationship: 'hija',
        latestAssessment: null,
      });
      expect(
        mock.calls.filter((c) => c.table === 'initial_assessments'),
      ).toHaveLength(1);
    });
  });

  describe('create (agregar un hijo desde Configuración)', () => {
    const newChild = {
      firstName: ' Sara ',
      lastName: 'Villegas',
      documentType: DocumentType.RC,
      documentNumber: '1100223344',
      birthDate: '2020-03-10',
      age: 6,
      grade: 'Transición',
      institutionId: '11111111-1111-1111-1111-111111111111',
    };

    it('crea el estudiante, el vínculo, la matrícula y la licencia, y devuelve el hijo', async () => {
      const mock = setup({
        'students:insert': [{ data: { id: 'est-9' }, error: null }],
        'tutor_students:select': [
          {
            data: [{ student_id: 'est-9', relationship: 'hijo' }],
            error: null,
          },
        ],
        'students:select': [
          {
            data: [
              {
                ...matias,
                id: 'est-9',
                first_name: 'Sara',
                document_type: 'RC',
                document_number: '1100223344',
              },
            ],
            error: null,
          },
        ],
      });

      const student = await service.create('tutor-1', newChild);

      expect(student).toMatchObject({ id: 'est-9', firstName: 'Sara' });
      const inserts = mock.calls
        .filter((c) => c.op === 'insert')
        .map((c) => c.table);
      expect(inserts).toEqual([
        'students',
        'tutor_students',
        'student_enrollments',
        'licenses',
      ]);
    });

    it('si el documento ya existe responde 409 sin dejar datos', async () => {
      const mock = setup({
        'students:insert': [
          { data: null, error: { code: '23505', message: 'duplicate key' } },
        ],
      });

      await expect(service.create('tutor-1', newChild)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mock.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    });

    it('si falla el vínculo elimina el estudiante creado', async () => {
      const mock = setup({
        'students:insert': [{ data: { id: 'est-9' }, error: null }],
        'tutor_students:insert': [
          { data: null, error: { message: 'timeout' } },
        ],
      });

      await expect(service.create('tutor-1', newChild)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      const deletes = mock.calls
        .filter((c) => c.op === 'delete')
        .map((c) => c.table);
      expect(deletes).toEqual([
        'licenses',
        'student_enrollments',
        'tutor_students',
        'students',
      ]);
    });
  });
});
