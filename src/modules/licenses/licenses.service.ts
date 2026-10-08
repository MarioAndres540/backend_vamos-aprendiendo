import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLicenseDto, LicensePlan, LicenseOrigin } from './dto/create-license.dto';
import { QueryLicensesDto } from './dto/query-licenses.dto';

export interface EffectiveLicense {
  planType: LicensePlan;
  origin: LicenseOrigin;
  isActive: boolean;
  startsAt: string;
  expiresAt: string | null;
  daysRemaining: number | null;
  institutionName?: string | null;
  features: {
    unlimitedActivities: boolean;
    advancedAnalytics: boolean;
    multiProfile: boolean;
    exportReports: boolean;
  };
}

@Injectable()
export class LicensesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Obtiene la licencia efectiva más favorable para un usuario o estudiante.
   * Prioridad: Pro Institucional > Pro Personal > Trial Vigente (14d) > Free
   */
  async getEffectiveLicense(userId: string, studentId?: string): Promise<EffectiveLicense> {
    const supabase = this.supabaseService.getClient();
    const now = new Date();

    // 1. Buscar todas las licencias asociadas al usuario o al estudiante
    let query = supabase
      .from('licenses')
      .select('id, plan_type, origin, starts_at, expires_at, is_active, institution_id, student_id, owner_profile_id, institutions(name)')
      .eq('is_active', true);

    if (studentId) {
      query = query.or(`owner_profile_id.eq.${userId},student_id.eq.${studentId}`);
    } else {
      query = query.eq('owner_profile_id', userId);
    }

    const { data: licenses, error } = await query;

    if (error) {
      throw new InternalServerErrorException(`Error al consultar licencias: ${error.message}`);
    }

    // 2. Evaluar licencias PRO activas
    const proLicense = (licenses || []).find((lic) => {
      if (lic.plan_type !== LicensePlan.PRO) return false;
      if (!lic.expires_at) return true;
      return new Date(lic.expires_at) > now;
    });

    if (proLicense) {
      const diffDays = proLicense.expires_at
        ? Math.max(0, Math.ceil((new Date(proLicense.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      const institutionName = proLicense.institutions ? (proLicense.institutions as any).name : null;

      return {
        planType: LicensePlan.PRO,
        origin: proLicense.origin as LicenseOrigin,
        isActive: true,
        startsAt: proLicense.starts_at,
        expiresAt: proLicense.expires_at,
        daysRemaining: diffDays,
        institutionName,
        features: {
          unlimitedActivities: true,
          advancedAnalytics: true,
          multiProfile: true,
          exportReports: true,
        },
      };
    }

    // 3. Evaluar licencias TRIAL activas
    const trialLicense = (licenses || []).find((lic) => {
      if (lic.plan_type !== LicensePlan.TRIAL) return false;
      if (!lic.expires_at) {
        const defaultExpiration = new Date(new Date(lic.starts_at).getTime() + 14 * 24 * 60 * 60 * 1000);
        return defaultExpiration > now;
      }
      return new Date(lic.expires_at) > now;
    });

    if (trialLicense) {
      const expirationDate = trialLicense.expires_at
        ? new Date(trialLicense.expires_at)
        : new Date(new Date(trialLicense.starts_at).getTime() + 14 * 24 * 60 * 60 * 1000);

      const daysRemaining = Math.max(
        0,
        Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );

      return {
        planType: LicensePlan.TRIAL,
        origin: trialLicense.origin as LicenseOrigin,
        isActive: daysRemaining > 0,
        startsAt: trialLicense.starts_at,
        expiresAt: expirationDate.toISOString(),
        daysRemaining,
        features: {
          unlimitedActivities: true,
          advancedAnalytics: false,
          multiProfile: true,
          exportReports: false,
        },
      };
    }

    // 4. Si no hay Pro ni Trial vigente, retornar plan FREE
    return {
      planType: LicensePlan.FREE,
      origin: LicenseOrigin.PERSONAL,
      isActive: true,
      startsAt: now.toISOString(),
      expiresAt: null,
      daysRemaining: null,
      features: {
        unlimitedActivities: false,
        advancedAnalytics: false,
        multiProfile: false,
        exportReports: false,
      },
    };
  }

  /**
   * Crear una licencia de prueba (Trial 14 días) al registrarse
   */
  async createTrialLicense(userId: string, studentId?: string) {
    const supabase = this.supabaseService.getClient();
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('licenses')
      .insert({
        plan_type: LicensePlan.TRIAL,
        origin: LicenseOrigin.PERSONAL,
        owner_profile_id: userId,
        student_id: studentId || null,
        starts_at: startsAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Error al generar licencia de prueba: ${error.message}`);
    }

    return data;
  }

  /**
   * Crear o asignar manualmente una licencia (Admin o Institución)
   */
  async create(dto: CreateLicenseDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('licenses')
      .insert({
        plan_type: dto.planType,
        origin: dto.origin,
        owner_profile_id: dto.ownerProfileId || null,
        institution_id: dto.institutionId || null,
        student_id: dto.studentId || null,
        starts_at: dto.startsAt || new Date().toISOString(),
        expires_at: dto.expiresAt || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error al crear licencia: ${error.message}`);
    }

    return {
      message: 'Licencia creada y asignada exitosamente',
      license: data,
    };
  }
}
