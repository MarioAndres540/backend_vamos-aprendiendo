/**
 * Constantes de protección de datos personales (Ley 1581 de 2012, spec 0004).
 * Cambiar PRIVACY_POLICY_VERSION cuando cambie el texto de la política en el frontend (/data-policy):
 * el registro rechaza versiones anteriores para que nadie acepte un texto que ya no es el vigente.
 */
export const PRIVACY_POLICY_VERSION = '2026-11-04';

/** Tipos de autorización (PD-D1). Solo datos_sensibles es facultativa y se puede cambiar desde la cuenta */
export enum ConsentType {
  DATA_PROCESSING = 'tratamiento_datos',
  MINORS_DATA = 'datos_menores',
  SENSITIVE_DATA = 'datos_sensibles',
}

/** Solicitudes del titular: la consulta (art. 14) y los reclamos (art. 15) */
export enum DataRequestType {
  QUERY = 'consulta',
  UPDATE = 'actualizacion',
  RECTIFICATION = 'rectificacion',
  SUPPRESSION = 'supresion',
  REVOCATION = 'revocatoria',
  PROOF_OF_CONSENT = 'prueba_autorizacion',
}

export enum DataRequestStatus {
  FILED = 'radicada',
  IN_PROGRESS = 'en_tramite',
  RESOLVED = 'resuelta',
  REJECTED = 'rechazada',
}

export const OPEN_REQUEST_STATUSES: DataRequestStatus[] = [
  DataRequestStatus.FILED,
  DataRequestStatus.IN_PROGRESS,
];

/** Plazos legales en días hábiles: consulta 10 (art. 14), reclamos 15 (art. 15) */
export const QUERY_DUE_BUSINESS_DAYS = 10;
export const CLAIM_DUE_BUSINESS_DAYS = 15;

/** Código que el frontend usa para ofrecer "Autorizar y continuar" u "Omitir" (PD-SENS-01) */
export const SENSITIVE_CONSENT_REQUIRED = 'SENSITIVE_CONSENT_REQUIRED';

/** Prueba de la autorización (Decreto 1377, art. 8): desde dónde se otorgó */
export interface ConsentMeta {
  ip?: string;
  userAgent?: string;
}

export interface ConsentItem {
  type: ConsentType;
  granted: boolean;
  studentId?: string | null;
}

/** Filas para privacy_consents: inmutables, una por autorización otorgada o negada */
export const buildConsentRows = (
  profileId: string,
  items: ConsentItem[],
  meta: ConsentMeta = {},
  policyVersion: string = PRIVACY_POLICY_VERSION,
) =>
  items.map((item) => ({
    profile_id: profileId,
    student_id: item.studentId ?? null,
    consent_type: item.type,
    granted: item.granted,
    policy_version: policyVersion,
    ip_address: meta.ip?.slice(0, 64) ?? null,
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
  }));
