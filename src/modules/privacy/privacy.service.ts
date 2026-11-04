import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { addBusinessDays } from './business-days';
import {
  CLAIM_DUE_BUSINESS_DAYS,
  ConsentItem,
  ConsentMeta,
  ConsentType,
  DataRequestStatus,
  DataRequestType,
  OPEN_REQUEST_STATUSES,
  PRIVACY_POLICY_VERSION,
  QUERY_DUE_BUSINESS_DAYS,
  buildConsentRows,
} from './privacy.constants';
import { CreateDataRequestDto } from './dto/create-data-request.dto';
import { UpdateConsentDto } from './dto/update-consent.dto';
import { UpdateDataRequestDto } from './dto/update-data-request.dto';

export interface ConsentState {
  granted: boolean;
  policyVersion: string;
  grantedAt: string | null;
}

export interface CurrentConsents {
  policyVersion: string;
  dataProcessing: ConsentState | null;
  sensitiveData: ConsentState | null;
  minorsData: (ConsentState & { studentId: string })[];
}

interface ConsentRow {
  consent_type: ConsentType;
  granted: boolean;
  policy_version: string;
  student_id: string | null;
  created_at?: string | null;
}

export interface DataRequestRow {
  id: string;
  profile_id: string;
  student_id: string | null;
  request_type: DataRequestType;
  status: DataRequestStatus;
  due_at: string;
  [key: string]: unknown;
}

/** Resultado de una consulta: el cliente de Supabase del proyecto no tiene tipos generados */
type DbResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

// Mensajes de la función suppress_titular_data → respuesta HTTP
const SUPPRESSION_ERRORS: Record<string, () => Error> = {
  TITULAR_NOT_SUPPORTED: () =>
    new ConflictException(
      'Esta cuenta es de un profesor, estudiante o administrador. Sus datos escolares los responde el colegio: tramita la solicitud con él.',
    ),
  STUDENT_NOT_LINKED: () =>
    new ConflictException(
      'El menor de la solicitud ya no está vinculado al titular.',
    ),
  TITULAR_NOT_FOUND: () =>
    new NotFoundException('El titular de la solicitud no existe.'),
};

const toState = (row: ConsentRow): ConsentState => ({
  granted: row.granted,
  policyVersion: row.policy_version,
  grantedAt: row.created_at ?? null,
});

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  /** PD-POL-03: versión vigente de la política (pública) */
  getPolicy() {
    return { version: PRIVACY_POLICY_VERSION };
  }

  /** PD-POL-03: quien acepta una versión anterior no aceptó el texto vigente */
  assertCurrentPolicyVersion(version: string | undefined) {
    if (version !== PRIVACY_POLICY_VERSION) {
      throw new BadRequestException(
        'La política de tratamiento de datos cambió. Recarga la página, revísala y vuelve a aceptarla.',
      );
    }
  }

  /** PD-CONS-02: guarda la prueba de las autorizaciones. Lanza si no se pudo guardar */
  async recordConsents(
    profileId: string,
    items: ConsentItem[],
    meta: ConsentMeta = {},
  ) {
    if (items.length === 0) return;
    const { error } = await this.supabaseService
      .getClient()
      .from('privacy_consents')
      .insert(buildConsentRows(profileId, items, meta));
    if (error) {
      this.logger.error(
        `No se pudo guardar la autorización de ${profileId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos guardar tu autorización. Intenta de nuevo en unos minutos.',
      );
    }
  }

  /** PD-CONS-05: estado vigente (la última fila de cada tipo; para menores, la última de cada menor) */
  async getCurrentConsents(profileId: string): Promise<CurrentConsents> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('privacy_consents')
      .select('consent_type, granted, policy_version, student_id, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        'No pudimos consultar tus autorizaciones.',
      );
    }

    const result: CurrentConsents = {
      policyVersion: PRIVACY_POLICY_VERSION,
      dataProcessing: null,
      sensitiveData: null,
      minorsData: [],
    };
    const minors = new Map<string, ConsentState & { studentId: string }>();
    // Orden ascendente: la última fila de cada tipo es la vigente
    for (const row of (data ?? []) as ConsentRow[]) {
      if (row.consent_type === ConsentType.DATA_PROCESSING)
        result.dataProcessing = toState(row);
      if (row.consent_type === ConsentType.SENSITIVE_DATA)
        result.sensitiveData = toState(row);
      if (row.consent_type === ConsentType.MINORS_DATA && row.student_id) {
        minors.set(row.student_id, {
          ...toState(row),
          studentId: row.student_id,
        });
      }
    }
    result.minorsData = [...minors.values()];
    return result;
  }

  /** PD-SENS-01 */
  async hasSensitiveDataConsent(profileId: string): Promise<boolean> {
    const consents = await this.getCurrentConsents(profileId);
    return consents.sensitiveData?.granted === true;
  }

  /**
   * PD-SENS-03: otorga o revoca la autorización de datos sensibles. Al revocarla se borran las
   * evaluaciones iniciales que hizo el titular (incluidas las de sus menores).
   * Las autorizaciones obligatorias se revocan con una solicitud (PD-ARCO-02), no desde aquí.
   */
  async updateConsent(
    profileId: string,
    dto: UpdateConsentDto,
    meta: ConsentMeta = {},
  ) {
    if (dto.type !== ConsentType.SENSITIVE_DATA) {
      throw new BadRequestException(
        'Esta autorización es necesaria para prestar el servicio. Para revocarla, radica una solicitud de revocatoria o supresión.',
      );
    }

    await this.recordConsents(
      profileId,
      [{ type: dto.type, granted: dto.granted }],
      meta,
    );

    let deletedAssessments = 0;
    if (!dto.granted) {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('initial_assessments')
        .delete()
        .eq('evaluator_profile_id', profileId)
        .select('id');
      if (error) {
        this.logger.error(
          `No se borraron las evaluaciones de ${profileId} al revocar: ${error.message}`,
        );
        throw new InternalServerErrorException(
          'Guardamos tu revocatoria, pero no pudimos borrar tus evaluaciones. Intenta de nuevo o radica una solicitud de supresión.',
        );
      }
      deletedAssessments = (data ?? []).length;
    }

    return {
      ...(await this.getCurrentConsents(profileId)),
      deletedAssessments,
    };
  }

  /** PD-ARCO-01: datos del titular y de SU ecosistema (sin datos de otros tutores ni del colegio) */
  async exportMyData(profileId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, email, first_name, last_name, document_type, document_number, age, phone, role, created_at',
      )
      .eq('id', profileId)
      .single();
    if (profileError || !profile) {
      throw new NotFoundException('No encontramos tu cuenta.');
    }

    const { data: links } = await supabase
      .from('tutor_students')
      .select('student_id, relationship, created_at')
      .eq('tutor_profile_id', profileId);
    const studentIds = (links ?? []).map(
      (l: { student_id: string }) => l.student_id,
    );

    const { data: students } = studentIds.length
      ? await supabase
          .from('students')
          .select(
            'id, first_name, last_name, document_type, document_number, birth_date, grade, institution_id',
          )
          .in('id', studentIds)
      : { data: [] };

    const [consents, requests, assessments, completions, xp] =
      await Promise.all([
        supabase
          .from('privacy_consents')
          .select(
            'consent_type, granted, policy_version, student_id, created_at',
          )
          .eq('profile_id', profileId),
        supabase
          .from('data_requests')
          .select(
            'id, request_type, student_id, description, status, due_at, response, created_at, resolved_at',
          )
          .eq('profile_id', profileId),
        supabase
          .from('initial_assessments')
          .select(
            'id, student_id, target_type, total_score, max_score, risk_level, primary_condition, answers, recommendations, created_at',
          )
          .eq('evaluator_profile_id', profileId),
        // Progreso del ecosistema del titular: solo lo que se registró con su cuenta
        supabase
          .from('exercise_completions')
          .select('exercise_id, estudiante_id, context, completed_at')
          .eq('usuario_id', profileId),
        supabase
          .from('xp_ledger')
          .select('estudiante_id, xp_amount')
          .eq('usuario_id', profileId),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      policyVersion: PRIVACY_POLICY_VERSION,
      profile,
      minors: (students ?? []).map((s: { id: string }) => ({
        ...s,
        relationship:
          (
            (links ?? []) as { student_id: string; relationship: string }[]
          ).find((l) => l.student_id === s.id)?.relationship ?? null,
      })),
      consents: consents.data ?? [],
      requests: requests.data ?? [],
      assessments: assessments.data ?? [],
      progress: {
        completedExercises: completions.data ?? [],
        totalXp: ((xp.data ?? []) as { xp_amount: number | null }[]).reduce(
          (sum, row) => sum + (row.xp_amount ?? 0),
          0,
        ),
      },
    };
  }

  /** PD-ARCO-02, 03 y 05: radica una solicitud con su plazo legal */
  async createRequest(
    profileId: string,
    dto: CreateDataRequestDto,
    now: Date = new Date(),
  ) {
    const supabase = this.supabaseService.getClient();

    if (dto.studentId) {
      const { data: link } = await supabase
        .from('tutor_students')
        .select('id')
        .eq('tutor_profile_id', profileId)
        .eq('student_id', dto.studentId)
        .maybeSingle();
      if (!link) {
        throw new NotFoundException('Ese menor no está vinculado a tu cuenta.');
      }
    }

    const businessDays =
      dto.type === DataRequestType.QUERY
        ? QUERY_DUE_BUSINESS_DAYS
        : CLAIM_DUE_BUSINESS_DAYS;

    const { data, error } = (await supabase
      .from('data_requests')
      .insert({
        profile_id: profileId,
        student_id: dto.studentId ?? null,
        request_type: dto.type,
        description: dto.description.trim(),
        status: DataRequestStatus.FILED,
        due_at: addBusinessDays(now, businessDays).toISOString(),
      })
      .select()
      .single()) as DbResult<DataRequestRow>;

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Ya tienes una solicitud de este tipo en trámite. Te responderemos dentro del plazo indicado.',
        );
      }
      throw new InternalServerErrorException(
        'No pudimos radicar tu solicitud. Intenta de nuevo.',
      );
    }
    return data;
  }

  /** PD-ARCO-04 */
  async listMyRequests(profileId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('data_requests')
      .select(
        'id, request_type, student_id, description, status, due_at, response, created_at, resolved_at',
      )
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    if (error) {
      throw new InternalServerErrorException(
        'No pudimos consultar tus solicitudes.',
      );
    }
    return data ?? [];
  }

  // ==========================================
  // SUPER ADMINISTRADOR (PD-ADM)
  // ==========================================

  /** PD-ADM-01: con marca de vencida para las abiertas fuera de plazo */
  async listRequests(status?: DataRequestStatus, now: Date = new Date()) {
    let query = this.supabaseService
      .getClient()
      .from('data_requests')
      .select(
        '*, titular:profiles!data_requests_profile_id_fkey(first_name, last_name, email, role)',
      )
      .order('due_at', { ascending: true });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException(
        'No pudimos consultar las solicitudes.',
      );
    }
    return ((data ?? []) as DataRequestRow[]).map((row) => ({
      ...row,
      overdue:
        OPEN_REQUEST_STATUSES.includes(row.status) &&
        new Date(row.due_at).getTime() < now.getTime(),
    }));
  }

  /** PD-ADM-02 */
  async updateRequest(actorId: string, id: string, dto: UpdateDataRequestDto) {
    const isClosing =
      dto.status === DataRequestStatus.RESOLVED ||
      dto.status === DataRequestStatus.REJECTED;
    if (isClosing && !dto.response?.trim()) {
      throw new BadRequestException(
        'Para resolver o rechazar la solicitud escribe la respuesta al titular.',
      );
    }

    await this.findRequest(id);

    const { data, error } = (await this.supabaseService
      .getClient()
      .from('data_requests')
      .update({
        status: dto.status,
        response: dto.response?.trim() ?? null,
        resolved_by: isClosing ? actorId : null,
        resolved_at: isClosing ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select()
      .single()) as DbResult<DataRequestRow>;
    if (error || !data) {
      throw new InternalServerErrorException(
        'No pudimos actualizar la solicitud.',
      );
    }

    await this.auditService.log(
      actorId,
      isClosing ? 'resolve' : 'update',
      'data_request',
      id,
      {
        status: dto.status,
      },
    );
    return data;
  }

  /**
   * PD-ADM-03: ejecuta la supresión limitada al ecosistema del titular (PD-D3 y PD-D4).
   * La parte de base de datos es una sola transacción (suppress_titular_data); después se cierra el
   * acceso al usuario de Auth si la cuenta quedó anonimizada.
   */
  async executeSuppression(actorId: string, id: string) {
    const request = await this.findRequest(id);

    if (
      request.request_type !== DataRequestType.SUPPRESSION &&
      request.request_type !== DataRequestType.REVOCATION
    ) {
      throw new BadRequestException(
        'Solo las solicitudes de supresión o revocatoria ejecutan una supresión.',
      );
    }
    if (!OPEN_REQUEST_STATUSES.includes(request.status)) {
      throw new ConflictException('La solicitud ya está cerrada.');
    }

    const supabase = this.supabaseService.getClient();
    const { data: summary, error } = (await supabase.rpc(
      'suppress_titular_data',
      {
        p_profile_id: request.profile_id,
        p_student_id: request.student_id,
      },
    )) as DbResult<unknown>;

    if (error) {
      const known = Object.keys(SUPPRESSION_ERRORS).find((code) =>
        error.message?.includes(code),
      );
      if (known) throw SUPPRESSION_ERRORS[known]();
      this.logger.error(
        `Supresión de la solicitud ${id} falló: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos ejecutar la supresión. No se borró ningún dato.',
      );
    }

    const result = (summary ?? {}) as {
      deletedStudents?: string[];
      unlinkedStudents?: string[];
      anonymized?: boolean;
    };

    // Cuenta anonimizada: el usuario de Auth deja de servir para entrar (no se borra: D-6)
    let authClosed = true;
    if (result.anonymized) {
      const { error: authError } = await supabase.auth.admin.updateUserById(
        request.profile_id,
        {
          email: `suprimido-${request.profile_id}@supresion.invalid`,
          password: crypto.randomBytes(32).toString('base64url'),
          ban_duration: '876000h',
          user_metadata: {},
        },
      );
      if (authError) {
        authClosed = false;
        this.logger.error(
          `Supresión ${id}: el perfil quedó anonimizado, pero no se cerró el usuario de Auth: ${authError.message}`,
        );
      }
    }

    const deleted = result.deletedStudents?.length ?? 0;
    const unlinked = result.unlinkedStudents?.length ?? 0;
    const response = [
      'Suprimimos los datos de tu ecosistema en la plataforma.',
      result.anonymized ? 'Tu cuenta quedó anonimizada y desactivada.' : null,
      deleted
        ? `Borramos los datos de ${deleted} menor(es) que no tenían otro tutor ni colegio.`
        : null,
      unlinked
        ? `${unlinked} menor(es) siguen registrados con otro tutor o con su colegio, que responden por esos datos.`
        : null,
      'Conservamos únicamente los registros de licencias exigidos por la ley contable, sin datos que te identifiquen.',
    ]
      .filter(Boolean)
      .join(' ');

    const { error: updateError } = await supabase
      .from('data_requests')
      .update({
        status: DataRequestStatus.RESOLVED,
        response,
        resolved_by: actorId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateError) {
      this.logger.error(
        `Supresión ${id} ejecutada, pero la solicitud no quedó resuelta: ${updateError.message}`,
      );
    }

    await this.auditService.log(actorId, 'suppress', 'data_request', id, {
      anonymized: result.anonymized === true,
      deletedStudents: deleted,
      unlinkedStudents: unlinked,
      authClosed,
    });

    return { ...result, authClosed, response };
  }

  private async findRequest(id: string): Promise<DataRequestRow> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('data_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle()) as DbResult<DataRequestRow>;
    if (error) {
      throw new InternalServerErrorException(
        'No pudimos consultar la solicitud.',
      );
    }
    if (!data) {
      throw new NotFoundException('La solicitud no existe.');
    }
    return data;
  }
}
