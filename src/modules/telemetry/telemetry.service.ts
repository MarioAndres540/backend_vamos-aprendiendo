import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { RecordExerciseDto } from './dto/record-exercise.dto';
import { ImportExercisesDto } from './dto/import-exercises.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de filas por consulta de telemetría (trazos u operaciones) en el periodo
export const TELEMETRY_ROWS_LIMIT = 1000;
// Tope de filas para el progreso por ruta y la experiencia (acotadas por el catálogo de ejercicios)
export const EXERCISE_ROWS_LIMIT = 10000;

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
  // null mientras Unity no envíe la métrica: no cuenta como 0
  precision_pct: number | string | null;
  tiempo_trazo_seg: number | string | null;
  desviaciones: { alerta?: string } | null;
  created_at: string;
}

interface OperationRow {
  tiempo_seg: number | string;
  correcto: boolean;
}

interface RouteRow {
  id: string;
  name: string;
}

interface LedgerRow {
  source_id: string;
  xp_amount: number | string;
  created_at: string;
}

/** Respuesta de record_exercise_attempt (migración 20261031) */
/** Respuesta de import_completed_exercises (migración 20261101) */
export interface ImportResult {
  imported: number;
  /** Ya estaban aprobados: no se tocan ni dan XP */
  skipped: number;
  /** No existen o no están activos en el catálogo (ej. consonantes) */
  unknown: number;
  xpAwarded: number;
  totalXp: number;
}

export interface ExerciseResult {
  attemptId: string;
  exerciseId: string;
  passed: boolean;
  attemptNumber: number;
  /** La petición ya se había procesado (mismo clientAttemptId): se devuelve el resultado original */
  duplicate: boolean;
  /** Aprobó, pero el ejercicio ya estaba aprobado antes: no hay XP nuevo */
  alreadyCompleted: boolean;
  awarded: boolean;
  xpAwarded: number;
  totalXp: number;
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
// Solo valores reales: un null (métrica que Unity aún no envía) no se promedia como 0
const presentNumbers = (values: (number | string | null | undefined)[]) =>
  values.filter((v) => v !== null && v !== undefined).map(Number);
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
        presentNumbers(numbers.map((s) => s.precision_pct)),
        range('numeros', 'precision_pct'),
      ),
      this.metric(
        'numbers_stroke_time',
        'Tiempo por trazo de número',
        's',
        presentNumbers(numbers.map((s) => s.tiempo_trazo_seg)),
        range('numeros', 'tiempo_trazo_seg'),
      ),
      this.metric(
        'letters_precision',
        'Precisión al trazar letras',
        '%',
        presentNumbers(letters.map((s) => s.precision_pct)),
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
   * Registra un intento de ejercicio de Unity (una letra o un número) y, si queda aprobado por primera vez, entrega
   * el XP. Todo ocurre en la función SQL record_exercise_attempt (una transacción, con candado por estudiante y
   * ejercicio): no puede quedar un ejercicio aprobado sin su XP ni XP duplicado, aunque la petición se repita o
   * llegue en paralelo. El cliente envía cobertura y exactitud; quien decide si aprobó es reward_rules.
   */
  async recordExercise(userId: string, dto: RecordExerciseDto) {
    // El hijo debe ser del tutor autenticado: no se confía en el studentId que llega
    const owner = await this.resolveOwner(userId, dto.studentId);

    // Un tutor con hijos tiene que decir quién juega; si no, el XP quedaría en la cuenta del tutor
    if (!owner.studentId) await this.assertHasNoLinkedStudents(userId);

    const strokes = (list?: { points: unknown[] }[]) =>
      list?.map((stroke) => stroke.points);

    const rpcResult = (await this.supabaseService
      .getClient()
      .rpc('record_exercise_attempt', {
        p_user_id: owner.userId,
        p_student_id: owner.studentId,
        p_exercise_id: dto.exerciseId,
        p_client_attempt_id: dto.clientAttemptId,
        p_payload: {
          coverage: dto.coverage,
          accuracy: dto.accuracy,
          durationSeconds: dto.durationSeconds,
          precisionPct: dto.precisionPct,
          startPointOk: dto.startPointOk,
          orderOk: dto.orderOk,
          direction: dto.direction,
          rotationDegrees: dto.rotationDegrees,
          offPathCount: dto.offPathCount,
          expectedPath: strokes(dto.expectedPath),
          userStrokes: strokes(dto.userStrokes),
          deviations: dto.deviations
            ? {
                alerta: dto.deviations.alerta,
                patron_atipico: dto.deviations.patronAtipico,
              }
            : undefined,
        },
      })) as {
      data: ExerciseResult | null;
      error: { message?: string; code?: string } | null;
    };
    const { data, error } = rpcResult;

    if (error) {
      if (error.message?.includes('EXERCISE_NOT_FOUND')) {
        throw new NotFoundException(
          'El ejercicio no existe o todavía no está disponible.',
        );
      }
      this.fail('registrar el ejercicio', error);
    }

    // Sin error, la función SQL siempre devuelve un resultado
    return { studentId: owner.studentId, ...(data as ExerciseResult) };
  }

  /**
   * Importa los ejercicios que el dispositivo ya tenía completados antes de enviarse al backend. Quedan registrados
   * como `source = 'import'` (sin cobertura ni exactitud inventadas) y entregan el XP de la regla `exercise_imported`,
   * una sola vez por ejercicio. Es idempotente: lo que ya está aprobado se omite.
   */
  async importExercises(userId: string, dto: ImportExercisesDto) {
    const owner = await this.resolveOwner(userId, dto.studentId);
    if (!owner.studentId) await this.assertHasNoLinkedStudents(userId);

    const rpcResult = (await this.supabaseService
      .getClient()
      .rpc('import_completed_exercises', {
        p_user_id: owner.userId,
        p_student_id: owner.studentId,
        p_exercise_ids: dto.exerciseIds,
      })) as {
      data: ImportResult | null;
      error: { message?: string; code?: string } | null;
    };

    if (rpcResult.error) this.fail('importar los ejercicios', rpcResult.error);

    return { studentId: owner.studentId, ...(rpcResult.data as ImportResult) };
  }

  /**
   * Progreso por ruta de aprendizaje (Matemáticas, Escritura...), con datos reales:
   * completados = ejercicios aprobados; en progreso = con intentos registrados pero sin aprobar;
   * pendientes = disponibles (exercise_catalog.is_active) sin ningún intento. `hasData` es false mientras la app
   * no haya enviado nada de este estudiante: así el dashboard no presenta como "pendiente" lo que simplemente no se sabe.
   */
  async getRouteProgress(userId: string, studentId?: string) {
    const owner = await this.resolveOwner(userId, studentId);
    const supabase = this.supabaseService.getClient();

    let attemptsQuery = supabase
      .from('trazos')
      .select('exercise_id')
      .eq('usuario_id', owner.userId)
      .not('exercise_id', 'is', null);
    attemptsQuery = owner.studentId
      ? attemptsQuery.eq('estudiante_id', owner.studentId)
      : attemptsQuery.is('estudiante_id', null);

    const [routesResult, catalogResult, completionsResult, attemptsResult] =
      await Promise.all([
        supabase
          .from('learning_routes')
          .select('id, name, sort_order')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('exercise_catalog')
          .select('id, route_id, sort_order')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('exercise_completions')
          .select('exercise_id')
          .eq('owner_id', owner.studentId ?? owner.userId),
        attemptsQuery.limit(EXERCISE_ROWS_LIMIT),
      ]);

    if (routesResult.error)
      this.fail('consultar las rutas', routesResult.error);
    if (catalogResult.error)
      this.fail('consultar el catálogo de ejercicios', catalogResult.error);
    if (completionsResult.error)
      this.fail('consultar los ejercicios aprobados', completionsResult.error);
    if (attemptsResult.error)
      this.fail('consultar los intentos', attemptsResult.error);

    const completed = new Set(
      ((completionsResult.data ?? []) as { exercise_id: string }[]).map(
        (row) => row.exercise_id,
      ),
    );
    const attempted = new Set(
      ((attemptsResult.data ?? []) as { exercise_id: string }[]).map(
        (row) => row.exercise_id,
      ),
    );
    const catalog = (catalogResult.data ?? []) as {
      id: string;
      route_id: string;
    }[];

    const routes = ((routesResult.data ?? []) as RouteRow[]).map((route) => {
      const exercises = catalog.filter((e) => e.route_id === route.id);
      const done = exercises.filter((e) => completed.has(e.id));
      const inProgress = exercises.filter(
        (e) => !completed.has(e.id) && attempted.has(e.id),
      );
      const total = exercises.length;
      return {
        id: route.id,
        name: route.name,
        total,
        completed: done.length,
        inProgress: inProgress.length,
        pending: total - done.length - inProgress.length,
        percentCompleted: total ? Math.round((done.length * 100) / total) : 0,
        completedExerciseIds: done.map((e) => e.id),
      };
    });

    return {
      studentId: owner.studentId,
      hasData: completed.size > 0 || attempted.size > 0,
      routes,
    };
  }

  /**
   * Experiencia (XP) acumulada del estudiante y sus recompensas más recientes. Los niveles se calcularán después
   * a partir de totalXp; por ahora solo se acumula y se consulta.
   */
  async getXp(userId: string, studentId?: string, limit = 20) {
    const owner = await this.resolveOwner(userId, studentId);
    const supabase = this.supabaseService.getClient();

    const ledgerResult = await supabase
      .from('xp_ledger')
      .select('source_id, xp_amount, created_at')
      .eq('owner_id', owner.studentId ?? owner.userId)
      .order('created_at', { ascending: false })
      .limit(EXERCISE_ROWS_LIMIT);
    if (ledgerResult.error)
      this.fail('consultar la experiencia', ledgerResult.error);

    // Una fila por ejercicio aprobado: acotada por el tamaño del catálogo
    const ledger = (ledgerResult.data ?? []) as LedgerRow[];
    const recent = ledger.slice(0, limit);

    let labels = new Map<string, string>();
    if (recent.length) {
      const catalogResult = await supabase
        .from('exercise_catalog')
        .select('id, label')
        .in(
          'id',
          recent.map((row) => row.source_id),
        );
      if (catalogResult.error)
        this.fail('consultar el catálogo de ejercicios', catalogResult.error);
      labels = new Map(
        ((catalogResult.data ?? []) as { id: string; label: string }[]).map(
          (row) => [row.id, row.label],
        ),
      );
    }

    return {
      studentId: owner.studentId,
      totalXp: ledger.reduce((sum, row) => sum + Number(row.xp_amount), 0),
      rewardsCount: ledger.length,
      history: recent.map((row) => ({
        exerciseId: row.source_id,
        label: labels.get(row.source_id) ?? row.source_id,
        xp: Number(row.xp_amount),
        awardedAt: row.created_at,
      })),
    };
  }

  private async assertHasNoLinkedStudents(userId: string) {
    const { count, error } = await this.supabaseService
      .getClient()
      .from('tutor_students')
      .select('id', { count: 'exact', head: true })
      .eq('tutor_profile_id', userId);

    if (error) this.fail('verificar los hijos de la cuenta', error);
    if (count) {
      throw new BadRequestException(
        'Elige el hijo que está jugando (studentId) para registrar el ejercicio.',
      );
    }
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
