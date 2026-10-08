import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AppSessionClient, StartAppSessionDto } from './dto/start-app-session.dto';
import { ClientEndReason } from './dto/end-app-session.dto';

// La app envía un latido cada 15 s; tras 45 s sin latidos (3 perdidos) la sesión se cierra por inactividad
export const HEARTBEAT_INTERVAL_SECONDS = 15;
export const SESSION_TIMEOUT_SECONDS = 45;

// Inicio del día en Colombia (UTC-5, sin horario de verano) para el resumen "hoy"
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

type EndReason = ClientEndReason | 'timeout';

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
  Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));

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

    if (dto.studentId) {
      const { count, error } = await supabase
        .from('tutor_students')
        .select('id', { count: 'exact', head: true })
        .eq('tutor_profile_id', userId)
        .eq('student_id', dto.studentId);

      if (error) this.fail('validar el estudiante', error);
      if (!count) {
        throw new BadRequestException('El estudiante no está vinculado a tu cuenta.');
      }
    }

    // Las sesiones que quedaron abiertas sin latidos (ej. la app se cerró a la fuerza) se cierran antes
    await this.closeStaleSessions(userId, client);

    const { data, error } = await supabase
      .from('app_sessions')
      .insert({
        user_id: userId,
        student_id: dto.studentId ?? null,
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

    if (!session.ended_at && secondsBetween(session.last_heartbeat_at, now) > SESSION_TIMEOUT_SECONDS) {
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
  async endSession(userId: string, sessionId: string, reason: ClientEndReason = 'app_closed') {
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
      if (result.error) this.fail('consultar el estado de la app', result.error);
    }

    const open = openResult.data as AppSessionRow | null;
    const last = lastResult.data as AppSessionRow | null;
    const todaySessions = (todayResult.data ?? []) as Pick<AppSessionRow, 'started_at' | 'last_heartbeat_at' | 'ended_at'>[];

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
            durationSeconds: secondsBetween(last.started_at, last.ended_at as string),
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

  // ==========================================
  // HELPERS
  // ==========================================

  private async findOwnSession(userId: string, sessionId: string): Promise<AppSessionRow> {
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
    const limit = new Date(Date.now() - SESSION_TIMEOUT_SECONDS * 1000).toISOString();

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

  private async closeSession(sessionId: string, endedAt: string, reason: EndReason) {
    const { error } = await this.supabaseService
      .getClient()
      .from('app_sessions')
      .update({ ended_at: endedAt, end_reason: reason })
      .eq('id', sessionId)
      .is('ended_at', null);

    if (error) this.fail('cerrar la sesión de la app', error);
  }

  private mapStudent(row: AppSessionRow) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    if (!row.student_id || !student) return null;
    return { id: row.student_id, firstName: student.first_name, lastName: student.last_name };
  }

  private startOfTodayColombia(now: Date) {
    const local = new Date(now.getTime() + COLOMBIA_OFFSET_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - COLOMBIA_OFFSET_MS);
  }

  private fail(action: string, error: { message?: string; code?: string } | null): never {
    this.logger.error(`Error al ${action}: ${error?.code ?? ''} ${error?.message ?? 'sin detalle'}`);
    throw new InternalServerErrorException(`No pudimos ${action}. Intenta de nuevo en unos minutos.`);
  }
}
