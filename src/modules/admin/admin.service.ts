import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminQueryUsersDto } from './dto/admin-query-users.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { AdminUpdateEmailDto } from './dto/admin-update-email.dto';
import { AdminExtendTrialDto } from './dto/admin-extend-trial.dto';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class AdminService {
  constructor(private readonly supabaseService: SupabaseService) {}

  // ==========================================
  // LISTAR USUARIOS CON FILTROS Y PAGINACIÓN
  // ==========================================
  async findAll(query: AdminQueryUsersDto) {
    const supabase = this.supabaseService.getClient();
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('profiles')
      .select('*', { count: 'exact' });

    if (query.role) {
      dbQuery = dbQuery.eq('role', query.role);
    }

    if (query.isActive !== undefined) {
      dbQuery = dbQuery.eq('is_active', query.isActive);
    }

    if (query.search) {
      const term = query.search.trim();
      dbQuery = dbQuery.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`,
      );
    }

    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await dbQuery;

    if (error) {
      throw new InternalServerErrorException(`Error al consultar usuarios: ${error.message}`);
    }

    const users = (data || []).map((user) => {
      let daysRemaining: number | null = null;
      if (user.role === Role.TEST && user.trial_ends_at) {
        const diffMs = new Date(user.trial_ends_at).getTime() - Date.now();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }
      return {
        ...user,
        days_remaining: daysRemaining,
      };
    });

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  // ==========================================
  // OBTENER DETALLES DE UN USUARIO
  // ==========================================
  async findById(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !profile) {
      throw new NotFoundException(`No se encontró el usuario con ID: ${id}`);
    }

    let daysRemaining: number | null = null;
    if (profile.role === Role.TEST && profile.trial_ends_at) {
      const diffMs = new Date(profile.trial_ends_at).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      ...profile,
      days_remaining: daysRemaining,
    };
  }

  // ==========================================
  // ACTUALIZAR INFORMACIÓN DEL PERFIL DE USUARIO
  // ==========================================
  async updateUser(id: string, dto: AdminUpdateUserDto) {
    const supabase = this.supabaseService.getClient();

    await this.findById(id);

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.firstName !== undefined) updatePayload.first_name = dto.firstName;
    if (dto.lastName !== undefined) updatePayload.last_name = dto.lastName;
    if (dto.documentType !== undefined) updatePayload.document_type = dto.documentType;
    if (dto.documentNumber !== undefined) updatePayload.document_number = dto.documentNumber;
    if (dto.age !== undefined) updatePayload.age = dto.age;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.role !== undefined) {
      updatePayload.role = dto.role;
      if (dto.role === Role.USER && dto.trialEndsAt === undefined) {
        updatePayload.trial_ends_at = null;
      }
    }
    if (dto.isActive !== undefined) updatePayload.is_active = dto.isActive;
    if (dto.trialEndsAt !== undefined) updatePayload.trial_ends_at = dto.trialEndsAt;

    const { data, error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error al actualizar perfil: ${error.message}`);
    }

    return {
      message: 'Usuario actualizado exitosamente',
      user: data,
    };
  }

  // ==========================================
  // ACTUALIZAR CORREO (SUPABASE AUTH + PROFILES)
  // ==========================================
  async updateEmail(id: string, dto: AdminUpdateEmailDto) {
    const supabase = this.supabaseService.getClient();

    await this.findById(id);

    // 1. Actualizar correo en Supabase Auth
    const { error: authError } = await supabase.auth.admin.updateUserById(id, {
      email: dto.email,
      email_confirm: true,
    });

    if (authError) {
      throw new BadRequestException(`Error al actualizar correo en autenticación: ${authError.message}`);
    }

    // 2. Actualizar correo en public.profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ email: dto.email, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (profileError) {
      throw new BadRequestException(`Error al actualizar correo en perfil: ${profileError.message}`);
    }

    return {
      message: 'Correo electrónico actualizado exitosamente',
      email: dto.email,
    };
  }

  // ==========================================
  // EXTENDER PERIODO DE PRUEBA (TEST ROLE)
  // ==========================================
  async extendTrial(id: string, dto: AdminExtendTrialDto) {
    const supabase = this.supabaseService.getClient();

    const user = await this.findById(id);

    const baseDate =
      user.trial_ends_at && new Date(user.trial_ends_at) > new Date()
        ? new Date(user.trial_ends_at)
        : new Date();

    const newTrialEndsAt = new Date(
      baseDate.getTime() + dto.days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from('profiles')
      .update({
        role: Role.TEST,
        trial_ends_at: newTrialEndsAt,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Error al extender periodo de prueba: ${error.message}`);
    }

    return {
      message: `Periodo de prueba extendido por ${dto.days} días`,
      trial_ends_at: newTrialEndsAt,
      user: data,
    };
  }

  // ==========================================
  // ELIMINAR USUARIO (AUTH + PROFILE)
  // ==========================================
  async deleteUser(id: string) {
    const supabase = this.supabaseService.getClient();

    await this.findById(id);

    // 1. Eliminar tokens de refresco
    await supabase.from('refresh_tokens').delete().eq('user_id', id);

    // 2. Eliminar perfil
    await supabase.from('profiles').delete().eq('id', id);

    // 3. Eliminar usuario en Supabase Auth
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    if (authError) {
      throw new BadRequestException(`Error al eliminar usuario en autenticación: ${authError.message}`);
    }

    return {
      message: 'Usuario eliminado exitosamente del sistema',
    };
  }
}
