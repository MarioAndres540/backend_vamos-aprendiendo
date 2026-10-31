import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de filas por consulta de telemetría (trazos u operaciones) en el periodo
export const TELEMETRY_ROWS_LIMIT = 1000;

/** Dueño de los datos: la cuenta y, si es un tutor, el hijo consultado */
interface Owner {
  userId: string;
  studentId: string | null;
  age: number | null;
}

interface CategoryRow {
  id: string;
  nombre: string;
  descripcion: string | null;
}

interface ProgressRow {
  categoria_id: string;
  puntaje_inicial: number | string;
  puntaje_actual: number | string;
  meta: number | string;
  nivel_actual: number;
  updated_at: string | null;
}

interface RangeRow {
  area: string;
  metrica: string;
  valor_esperado_min: number | string;
  valor_esperado_max: number | string;
}

interface StrokeRow {
  tipo_elemento: string;
  valor_esperado: string;
  precision_pct: number | string;
  tiempo_trazo_seg: number | string;
  desviaciones: { alerta?: string } | null;
  created_at: string;
}

interface OperationRow {
  tiempo_seg: number | string;
  correcto: boolean;
}

export type MetricStatus = 'within' | 'below' | 'above';

export interface PerformanceMetric {
  key: string;
  label: string;
  unit: '%' | 's';
  value: number | null;
  samples: number;
  expectedMin: number | null;
  expectedMax: number | null;
  status: MetricStatus | null;
}

// La edad llega sin tipo desde Supabase: solo se acepta un número
const toAge = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Progreso por categoría cognitiva (pestaña Actividades): las 7 categorías con el nivel y los puntos que
   * registra la app de Unity en progreso_categoria. Una categoría sin fila aún no se ha jugado.
   */
  async getProgress(userId: string, studentId?: string) {
    const owner = await this.resolveOwner(userId, studentId);
    const supabase = this.supabaseService.getClient();

    let progressQuery = supabase
      .from('progreso_categoria')
      .select(
        'categoria_id, puntaje_inicial, puntaje_actual, meta, nivel_actual, updated_at',
      )
      .eq('usuario_id', owner.userId);
    progressQuery = owner.studentId
      ? progressQuery.eq('estudiante_id', owner.studentId)
      : progressQuery.is('estudiante_id', null);

    const [categoriesResult, progressResult] = await Promise.all([
      supabase
        .from('categorias_cognitivas')
        .select('id, nombre, descripcion')
        .order('nombre'),
      progressQuery,
    ]);

    if (categoriesResult.error)
      this.fail('consultar las categorías', categoriesResult.error);
    if (progressResult.error)
      this.fail('consultar el progreso', progressResult.error);

    const progress = new Map(
      ((progressResult.data ?? []) as ProgressRow[]).map((row) => [
        row.categoria_id,
        row,
      ]),
    );

    return {
      studentId: owner.studentId,
      categories: ((categoriesResult.data ?? []) as CategoryRow[]).map(
        (category) => {
          const row = progress.get(category.id);
          return {
            id: category.id,
            name: category.nombre,
            description: category.descripcion,
            level: row?.nivel_actual ?? 1,
            score: Number(row?.puntaje_actual ?? 0),
            initialScore: Number(row?.puntaje_inicial ?? 0),
            goal: Number(row?.meta ?? 100),
            played: !!row,
            updatedAt: row?.updated_at ?? null,
          };
        },
      ),
    };
  }

  /**
   * Desempeño en el juego (pestaña Analíticas): promedios de trazos y operaciones del periodo comparados con
   * los rangos esperados para la edad (rangos_desarrollo), y avisos de trazos atípicos.
   */
  async getPerformance(userId: string, studentId?: string, days = 30) {
    const owner = await this.resolveOwner(userId, studentId);
    const supabase = this.supabaseService.getClient();
    const since = new Date(Date.now() - days * DAY_MS).toISOString();

    let strokesQuery = supabase
      .from('trazos')
      .select(
        'tipo_elemento, valor_esperado, precision_pct, tiempo_trazo_seg, desviaciones, created_at',
      )
      .eq('usuario_id', owner.userId)
      .gte('created_at', since);
    strokesQuery = owner.studentId
      ? strokesQuery.eq('estudiante_id', owner.studentId)
      : strokesQuery.is('estudiante_id', null);

    let operationsQuery = supabase
      .from('operaciones_resueltas')
      .select('tiempo_seg, correcto')
      .eq('usuario_id', owner.userId)
      .gte('created_at', since);
    operationsQuery = owner.studentId
      ? operationsQuery.eq('estudiante_id', owner.studentId)
      : operationsQuery.is('estudiante_id', null);

    let sessionsQuery = supabase
      .from('game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', owner.userId)
      .gte('started_at', since);
    sessionsQuery = owner.studentId
      ? sessionsQuery.eq('estudiante_id', owner.studentId)
      : sessionsQuery.is('estudiante_id', null);

    const rangesQuery =
      owner.age === null
        ? Promise.resolve({ data: [] as RangeRow[], error: null })
        : supabase
            .from('rangos_desarrollo')
            .select('area, metrica, valor_esperado_min, valor_esperado_max')
            .lte('edad_min', owner.age)
            .gte('edad_max', owner.age);

    const [strokesResult, operationsResult, sessionsResult, rangesResult] =
      await Promise.all([
        strokesQuery
          .order('created_at', { ascending: false })
          .limit(TELEMETRY_ROWS_LIMIT),
        operationsQuery.limit(TELEMETRY_ROWS_LIMIT),
        sessionsQuery,
        rangesQuery,
      ]);

    if (strokesResult.error)
      this.fail('consultar los trazos', strokesResult.error);
    if (operationsResult.error)
      this.fail('consultar las operaciones', operationsResult.error);
    if (sessionsResult.error)
      this.fail('consultar las sesiones de juego', sessionsResult.error);
    if (rangesResult.error)
      this.fail('consultar los rangos por edad', rangesResult.error);

    const strokes = (strokesResult.data ?? []) as StrokeRow[];
    const operations = (operationsResult.data ?? []) as OperationRow[];
    const ranges = (rangesResult.data ?? []) as RangeRow[];

    const range = (area: string, metric: string) => {
      const row = ranges.find((r) => r.area === area && r.metrica === metric);
      return row
        ? {
            min: Number(row.valor_esperado_min),
            max: Number(row.valor_esperado_max),
          }
        : null;
    };

    const numbers = strokes.filter((s) => s.tipo_elemento === 'numero');
    const letters = strokes.filter((s) => s.tipo_elemento === 'letra');

    const metrics: PerformanceMetric[] = [
      this.metric(
        'numbers_precision',
        'Precisión al trazar números',
        '%',
        numbers.map((s) => Number(s.precision_pct)),
        range('numeros', 'precision_pct'),
      ),
      this.metric(
        'numbers_stroke_time',
        'Tiempo por trazo de número',
        's',
        numbers.map((s) => Number(s.tiempo_trazo_seg)),
        range('numeros', 'tiempo_trazo_seg'),
      ),
      this.metric(
        'letters_precision',
        'Precisión al trazar letras',
        '%',
        letters.map((s) => Number(s.precision_pct)),
        range('letras', 'precision_pct'),
      ),
      this.metric(
        'operation_time',
        'Tiempo por operación',
        's',
        operations.map((o) => Number(o.tiempo_seg)),
        range('operaciones', 'tiempo_trazo_seg'),
      ),
      this.metric(
        'operations_accuracy',
        'Operaciones correctas',
        '%',
        operations.map((o) => (o.correcto ? 100 : 0)),
        null,
      ),
    ];

    // Avisos que la app deja en los trazos (ej. "Escribe de abajo hacia arriba y gira el 6")
    const alerts = strokes
      .filter(
        (s) =>
          typeof s.desviaciones?.alerta === 'string' &&
          s.desviaciones.alerta.trim(),
      )
      .slice(0, 5)
      .map((s) => ({
        createdAt: s.created_at,
        element: s.tipo_elemento,
        expected: s.valor_esperado,
        message: (s.desviaciones as { alerta: string }).alerta,
      }));

    return {
      studentId: owner.studentId,
      age: owner.age,
      days,
      from: since,
      gameSessionsCount: sessionsResult.count ?? 0,
      metrics,
      alerts,
    };
  }

  /**
   * Con studentId: el hijo debe estar vinculado al tutor (si no, 403) y se usa su edad.
   * Sin studentId: los datos del propio usuario, con la edad de su perfil.
   */
  private async resolveOwner(
    userId: string,
    studentId?: string,
  ): Promise<Owner> {
    const supabase = this.supabaseService.getClient();

    if (studentId) {
      const { data: link, error } = await supabase
        .from('tutor_students')
        .select('id')
        .eq('tutor_profile_id', userId)
        .eq('student_id', studentId)
        .maybeSingle();

      if (error) this.fail('verificar el estudiante', error);
      if (!link) {
        throw new ForbiddenException(
          'Este estudiante no está vinculado a tu cuenta.',
        );
      }

      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('age')
        .eq('id', studentId)
        .maybeSingle();
      if (studentError) this.fail('consultar el estudiante', studentError);

      return {
        userId,
        studentId,
        age: toAge(student?.age),
      };
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('age')
      .eq('id', userId)
      .maybeSingle();
    if (error) this.fail('consultar el perfil', error);

    return {
      userId,
      studentId: null,
      age: toAge(profile?.age),
    };
  }

  private metric(
    key: string,
    label: string,
    unit: '%' | 's',
    values: number[],
    expected: { min: number; max: number } | null,
  ): PerformanceMetric {
    const valid = values.filter((v) => Number.isFinite(v));
    const avg = average(valid);
    const value = avg === null ? null : round1(avg);

    let status: MetricStatus | null = null;
    if (value !== null && expected) {
      status =
        value < expected.min
          ? 'below'
          : value > expected.max
            ? 'above'
            : 'within';
    }

    return {
      key,
      label,
      unit,
      value,
      samples: valid.length,
      expectedMin: expected?.min ?? null,
      expectedMax: expected?.max ?? null,
      status,
    };
  }

  private fail(
    action: string,
    error: { message?: string; code?: string } | null,
  ): never {
    this.logger.error(
      `Error al ${action}: ${error?.code ?? ''} ${error?.message ?? 'sin detalle'}`,
    );
    throw new InternalServerErrorException(
      `No pudimos ${action}. Intenta de nuevo en unos minutos.`,
    );
  }
}
