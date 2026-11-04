import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type AuditAction =
  | 'create'
  | 'update'
  | 'deactivate'
  | 'reactivate'
  | 'delete'
  | 'resolve'
  | 'suppress';

/**
 * Registro de auditoría de las acciones del super administrador (spec 0003 SA-ROLE-04, spec 0004 PD-ADM-04).
 * Si el registro falla, la operación ya hecha no se revierte: queda un aviso en el log.
 * En details no van datos personales, solo identificadores y estados.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async log(
    actorProfileId: string,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('admin_audit_log')
        .insert({
          actor_profile_id: actorProfileId,
          action,
          entity_type: entityType,
          entity_id: entityId,
          details,
        });
      if (error) {
        this.logger.warn(
          `No se pudo registrar la auditoría ${action} ${entityType} ${entityId ?? ''}: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo registrar la auditoría ${action} ${entityType}: ${(err as Error).message}`,
      );
    }
  }
}
