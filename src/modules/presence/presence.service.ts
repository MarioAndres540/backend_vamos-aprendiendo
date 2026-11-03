import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  APP_TIME_ZONE,
  zonedParts,
  zonedStartOfDay,
} from '../../common/utils/timezone';
import {
  AppSessionClient,
  StartAppSessionDto,
} from './dto/start-app-session.dto';
import { ClientEndReason } from './dto/end-app-session.dto';
import {
  isStudentLinked,
  resolveAccountContext,
} from '../students/student-access';

// La app envía un latido cada 15 s; tras 45 s sin latidos (3 perdidos) la sesión se cierra por inactividad
export const HEARTBEAT_INTERVAL_SECONDS = 15;
export const SESSION_TIMEOUT_SECONDS = 45;

// Inicio del día en Colombia (UTC-5, sin horario de verano) para el resumen "hoy"
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Tope de sesiones que devuelve el historial (Analíticas)
export const HISTORY_SESSIONS_LIMIT = 500;

// Tope de sesiones que se leen para el tiempo mensual (dos meses de uso)
export const MONTHLY_SESSIONS_LIMIT = 5000;

type EndReason = ClientEndReason | 'timeout';

interface MonthlySessionRow {
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
}

interface AppSessionRow {
  id: string;
  user_id: string;
  student_id: string | null;
  client: AppSessionClient;
  device_info: string | null;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  end_reason: EndReason | null;
  // Relación con 'students' (muchos a uno): llega como objeto, aunque los tipos de supabase-js la infieren como lista
  students?: StudentName | StudentName[] | null;
}

interface StudentName {
  first_name: string;
  last_name: string;
}

const SESSION_COLUMNS =
  'id, user_id, student_id, client, device_info, started_at, last_heartbeat_at, ended_at, end_reason, students(first_name, last_name)';

const secondsBetween = (from: string, to: string | Date) =>
  Math.max(
    0,
    Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000),
  );

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  // ==========================================
  // CICLO DE VIDA DE LA SESIÓN (lo consume la app de Unity)
  // ==========================================

  /** Abre una sesión de uso de la app. Devuelve el id que la app debe usar en heartbeat y end. */
  async startSession(userId: string, dto: StartAppSessionDto) {
    const supabase = this.supabaseService.getClient();
    const client: AppSessionClient = dto.client ?? 'unity';

    // Spec 0001 CTX-06: el ambiente (hogar / escolar) lo define la cuenta, no la app
    const account = await resolveAccountContext(supabase, userId);
    if (account.error) this.fail('consultar la cuenta', account.error);

    let studentId = dto.studentId ?? null;
    if (account.ownStudentId) {
      // La cuenta de un alumno solo juega a su propio nombre
      if (studentId && studentId !== account.ownStudentId) {
        throw new BadRequestException(
          'El estudiante no está vinculado a tu cuenta.',
        );
      }
      studentId = account.ownStudentId;
    } else if (studentId) {
      const { linked, error } = await isStudentLinked(
        supabase,
        userId,
        studentId,
      );

      if (error) this.fail('validar el estudiante', error);
      if (!linked) {
        throw new BadRequestException(
          'El estudiante no está vinculado a tu cuenta.',
        );
      }
    }

    // Las sesiones que quedaron abiertas sin latidos (ej. la app se cerró a la fuerza) se cierran antes
    await this.closeStaleSessions(userId, client);

    const { data, error } = await supabase
      .from('app_sessions')
      .insert({
        user_id: userId,
        student_id: studentId,
        context: account.context,
        institution_id: account.institutionId,
        client,
        device_info: dto.deviceInfo ?? null,
        app_version: dto.appVersion ?? null,
      })
      .select('id, started_at')
      .single();

    if (error || !data) this.fail('iniciar la sesión de la app', error);

    return {
      sessionId: data.id,
      startedAt: data.started_at,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    };
  }

  /** Mantiene viva la sesión. Si ya terminó (o expiró), responde 409 para que la app abra una nueva. */
  async heartbeat(userId: string, sessionId: string) {
    const session = await this.findOwnSession(userId, sessionId);
    const now = new Date();

    if (
      !session.ended_at &&
      secondsBetween(session.last_heartbeat_at, now) > SESSION_TIMEOUT_SECONDS
    ) {
      await this.closeSession(session.id, session.last_heartbeat_at, 'timeout');
      session.ended_at = session.last_heartbeat_at;
    }

    if (session.ended_at) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'SESSION_ENDED',
        message: 'La sesión de la app ya terminó. Inicia una nueva sesión.',
      });
    }

    const { error } = await this.supabaseService
      .getClient()
      .from('app_sessions')
      .update({ last_heartbeat_at: now.toISOString() })
      .eq('id', session.id);

    if (error) this.fail('registrar el latido', error);

    return { sessionId: session.id, lastHeartbeatAt: now.toISOString() };
  }

  /** Cierra la sesión (la app se cerró o el usuario cerró sesión). Es idempotente. */
  async endSession(
    userId: string,
    sessionId: string,
    reason: ClientEndReason = 'app_closed',
  ) {
    const session = await this.findOwnSession(userId, sessionId);

    if (!session.ended_at) {
      const endedAt = new Date().toISOString();
      await this.closeSession(session.id, endedAt, reason);
      session.ended_at = endedAt;
      session.end_reason = reason;
    }

    return {
      sessionId: session.id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds: secondsBetween(session.started_at, session.ended_at),
      endReason: session.end_reason,
    };
  }

  // ==========================================
  // ESTADO PARA EL DASHBOARD
  // ==========================================

  /**
   * Estado de la app para una cuenta: si está conectada, desde cuándo y cuánto lleva;
   * si no, cuándo se desconectó y cuánto duró la última sesión. Incluye el resumen del día.
   */
  async getAppStatus(userId: string, client: AppSessionClient = 'unity') {
    const supabase = this.supabaseService.getClient();
    await this.closeStaleSessions(userId, client);
    const now = new Date();

    const [openResult, lastResult, todayResult] = await Promise.all([
      supabase
        .from('app_sessions')
        .select(SESSION_COLUMNS)
        .eq('user_id', userId)
        .eq('client', client)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('app_sessions')
        .select(SESSION_COLUMNS)
        .eq('user_id', userId)
        .eq('client', client)
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('app_sessions')
        .select('started_at, last_heartbeat_at, ended_at')
        .eq('user_id', userId)
        .eq('client', client)
        .gte('started_at', this.startOfTodayColombia(now).toISOString()),
    ]);

    for (const result of [openResult, lastResult, todayResult]) {
      if (result.error)
        this.fail('consultar el estado de la app', result.error);
    }

    const open = openResult.data as AppSessionRow | null;
    const last = lastResult.data as AppSessionRow | null;
    const todaySessions = (todayResult.data ?? []) as Pick<
      AppSessionRow,
      'started_at' | 'last_heartbeat_at' | 'ended_at'
    >[];

    return {
      client,
      isOnline: !!open,
      serverTime: now.toISOString(),
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      timeoutSeconds: SESSION_TIMEOUT_SECONDS,
      current: open
        ? {
            sessionId: open.id,
            startedAt: open.started_at,
            lastHeartbeatAt: open.last_heartbeat_at,
            durationSeconds: secondsBetween(open.started_at, now),
            deviceInfo: open.device_info,
            student: this.mapStudent(open),
          }
        : null,
      lastSession: last
        ? {
            sessionId: last.id,
            startedAt: last.started_at,
            endedAt: last.ended_at,
            durationSeconds: secondsBetween(
              last.started_at,
              last.ended_at as string,
            ),
            endReason: last.end_reason,
            deviceInfo: last.device_info,
            student: this.mapStudent(last),
          }
        : null,
      today: {
        sessionsCount: todaySessions.length,
        totalSeconds: todaySessions.reduce(
          (total, s) => total + secondsBetween(s.started_at, s.ended_at ?? now),
          0,
        ),
      },
    };
  }

  /**
   * Historial de uso de la app para la pestaña Analíticas: sesiones de los últimos `days` días (contando hoy,
   * en hora de Colombia), resumen y segundos por día. Una sesión cuenta en el día en que empezó.
   */
  async getHistory(
    userId: string,
    days = 30,
    client: AppSessionClient = 'unity',
  ) {
    await this.closeStaleSessions(userId, client);
    const now = new Date();
    const since = new Date(
      this.startOfTodayColombia(now).getTime() - (days - 1) * DAY_MS,
    );

    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_sessions')
      .select(SESSION_COLUMNS)
      .eq('user_id', userId)
      .eq('client', client)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .limit(HISTORY_SESSIONS_LIMIT);

    if (error) this.fail('consultar el historial de la app', error);

    const sessions = ((data ?? []) as unknown as AppSessionRow[]).map(
      (row) => ({
        sessionId: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        // Una sesión abierta cuenta hasta ahora
        durationSeconds: secondsBetween(row.started_at, row.ended_at ?? now),
        endReason: row.end_reason,
        isOpen: !row.ended_at,
        student: this.mapStudent(row),
      }),
    );

    const totalSeconds = sessions.reduce(
      (total, s) => total + s.durationSeconds,
      0,
    );

    const daily = Array.from({ length: days }, (_, i) => ({
      date: this.colombiaDateKey(new Date(since.getTime() + i * DAY_MS)),
      seconds: 0,
      sessionsCount: 0,
    }));
    const byDate = new Map(daily.map((day) => [day.date, day]));
    for (const session of sessions) {
      const day = byDate.get(this.colombiaDateKey(new Date(session.startedAt)));
      if (day) {
        day.seconds += session.durationSeconds;
        day.sessionsCount += 1;
      }
    }

    return {
      client,
      days,
      from: since.toISOString(),
      to: now.toISOString(),
      summary: {
        sessionsCount: sessions.length,
        totalSeconds,
        averageSeconds: sessions.length
          ? Math.round(totalSeconds / sessions.length)
          : 0,
        longestSeconds: sessions.reduce(
          (max, s) => Math.max(max, s.durationSeconds),
          0,
        ),
        lastStartedAt: sessions[0]?.startedAt ?? null,
      },
      daily,
      sessions,
    };
  }

  /**
   * Tiempo con la app abierta en el mes actual frente al MISMO tramo del mes anterior (hora de America/Bogota).
   * Si hoy es el día 17 a las 10:00, se compara del 1 al 17 a las 10:00 de este mes con el mismo tramo del mes
   * anterior (limitado a la duración de ese mes: el 31 de marzo contra febrero se compara con todo febrero).
   *
   * Qué mide: tiempo de CONEXIÓN de la app (de la apertura al último latido o cierre), no tiempo de juego activo: mientras la
   * app está abierta y en pausa o sin tocar sigue enviando latidos. Para no contarlo dos veces, las sesiones
   * que se solapan (dos dispositivos a la vez) se unen y una sesión que cruza la medianoche del cambio de mes se
   * reparte entre ambos meses. Una sesión abierta sin latidos recientes se cuenta hasta su último latido.
   */
  async getMonthlyUsage(
    userId: string,
    studentId?: string,
    client: AppSessionClient = 'unity',
  ) {
    if (studentId) await this.assertStudentLinked(userId, studentId);
    await this.closeStaleSessions(userId, client);

    const now = new Date();
    const { year, month } = zonedParts(now);
    const currentStart = zonedStartOfDay(year, month - 1, 1);
    const previousStart = zonedStartOfDay(year, month - 2, 1);
    const elapsedMs = now.getTime() - currentStart.getTime();
    const previousFullEnd = currentStart;
    const previousEnd = new Date(
      Math.min(previousStart.getTime() + elapsedMs, previousFullEnd.getTime()),
    );

    let query = this.supabaseService
      .getClient()
      .from('app_sessions')
      .select('started_at, last_heartbeat_at, ended_at')
      .eq('user_id', userId)
      .eq('client', client)
      .lt('started_at', now.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${previousStart.toISOString()}`);
    if (studentId) query = query.eq('student_id', studentId);

    const { data, error } = await query.limit(MONTHLY_SESSIONS_LIMIT);
    if (error) this.fail('consultar el tiempo de juego', error);

    const intervals = ((data ?? []) as MonthlySessionRow[]).map((row) =>
      this.sessionInterval(row, now),
    );

    const current = this.sumWindow(intervals, currentStart, now);
    const previous = this.sumWindow(intervals, previousStart, previousEnd);

    const differenceSeconds = current.seconds - previous.seconds;
    return {
      client,
      timeZone: APP_TIME_ZONE,
      studentId: studentId ?? null,
      // Mide conexión de la app (latidos), no juego activo
      measures: 'app_connection',
      elapsedDays: zonedParts(now).day,
      current: {
        from: currentStart.toISOString(),
        to: now.toISOString(),
        seconds: current.seconds,
        sessionsCount: current.sessionsCount,
      },
      previous: {
        from: previousStart.toISOString(),
        to: previousEnd.toISOString(),
        seconds: previous.seconds,
        sessionsCount: previous.sessionsCount,
        // El mes anterior es más corto que el tramo transcurrido: se comparó contra todo ese mes
        capped: previousEnd.getTime() >= previousFullEnd.getTime(),
      },
      comparison: {
        differenceSeconds,
        // Sin tiempo en el mes anterior no hay base para un porcentaje
        percentChange: previous.seconds
          ? Math.round((differenceSeconds * 1000) / previous.seconds) / 10
          : null,
        direction:
          differenceSeconds > 0
            ? 'up'
            : differenceSeconds < 0
              ? 'down'
              : 'same',
      },
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private async assertStudentLinked(userId: string, studentId: string) {
    const { linked, error } = await isStudentLinked(
      this.supabaseService.getClient(),
      userId,
      studentId,
    );

    if (error) this.fail('verificar el estudiante', error);
    if (!linked) {
      throw new ForbiddenException(
        'Este estudiante no está vinculado a tu cuenta.',
      );
    }
  }

  /** Tramo real de una sesión: abierta con latidos recientes cuenta hasta ahora; sin latidos, hasta el último latido */
  private sessionInterval(row: MonthlySessionRow, now: Date) {
    const start = new Date(row.started_at).getTime();
    let end: number;
    if (row.ended_at) {
      end = new Date(row.ended_at).getTime();
    } else {
      const lastBeat = new Date(row.last_heartbeat_at).getTime();
      end =
        now.getTime() - lastBeat > SESSION_TIMEOUT_SECONDS * 1000
          ? lastBeat
          : now.getTime();
    }
    return { start, end: Math.max(start, end) };
  }

  /** Segundos dentro de [from, to) uniendo los tramos que se solapan para no contar dos veces el mismo tiempo */
  private sumWindow(
    intervals: { start: number; end: number }[],
    from: Date,
    to: Date,
  ) {
    const clipped = intervals
      .map(({ start, end }) => ({
        start: Math.max(start, from.getTime()),
        end: Math.min(end, to.getTime()),
      }))
      .filter(({ start, end }) => end > start)
      .sort((a, b) => a.start - b.start);

    let totalMs = 0;
    let cursor = -Infinity;
    for (const { start, end } of clipped) {
      const effectiveStart = Math.max(start, cursor);
      if (end > effectiveStart) totalMs += end - effectiveStart;
      cursor = Math.max(cursor, end);
    }
    return {
      seconds: Math.floor(totalMs / 1000),
      sessionsCount: clipped.length,
    };
  }

  private async findOwnSession(
    userId: string,
    sessionId: string,
  ): Promise<AppSessionRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('app_sessions')
      .select(SESSION_COLUMNS)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) this.fail('consultar la sesión de la app', error);
    if (!data) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        code: 'SESSION_NOT_FOUND',
        message: 'La sesión de la app no existe o no pertenece a tu cuenta.',
      });
    }
    return data as unknown as AppSessionRow;
  }

  /** Cierra por inactividad las sesiones abiertas sin latidos; la hora de fin es la del último latido. */
  private async closeStaleSessions(userId: string, client: AppSessionClient) {
    const supabase = this.supabaseService.getClient();
    const limit = new Date(
      Date.now() - SESSION_TIMEOUT_SECONDS * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from('app_sessions')
      .select('id, last_heartbeat_at')
      .eq('user_id', userId)
      .eq('client', client)
      .is('ended_at', null)
      .lt('last_heartbeat_at', limit);

    if (error) this.fail('revisar sesiones inactivas', error);

    for (const stale of data ?? []) {
      await this.closeSession(stale.id, stale.last_heartbeat_at, 'timeout');
    }
  }

  private async closeSession(
    sessionId: string,
    endedAt: string,
    reason: EndReason,
  ) {
    const { error } = await this.supabaseService
      .getClient()
      .from('app_sessions')
      .update({ ended_at: endedAt, end_reason: reason })
      .eq('id', sessionId)
      .is('ended_at', null);

    if (error) this.fail('cerrar la sesión de la app', error);
  }

  private mapStudent(row: AppSessionRow) {
    const student = Array.isArray(row.students)
      ? row.students[0]
      : row.students;
    if (!row.student_id || !student) return null;
    return {
      id: row.student_id,
      firstName: student.first_name,
      lastName: student.last_name,
    };
  }

  private startOfTodayColombia(now: Date) {
    const local = new Date(now.getTime() + COLOMBIA_OFFSET_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - COLOMBIA_OFFSET_MS);
  }

  /** Fecha YYYY-MM-DD en hora de Colombia */
  private colombiaDateKey(date: Date) {
    return new Date(date.getTime() + COLOMBIA_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
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
