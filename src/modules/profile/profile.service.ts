import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateMyEmailDto } from './dto/update-my-email.dto';

const PROFILE_COLUMNS =
  'id, email, first_name, last_name, document_type, document_number, phone';

interface ProfileRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  document_type: string | null;
  document_number: string | null;
  phone: string | null;
}

export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  documentType: string | null;
  documentNumber: string | null;
  phone: string | null;
}

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Datos personales de la cuenta (vista de Configuración)
   */
  async getMe(userId: string): Promise<MyProfile> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error al consultar el perfil ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos cargar tus datos. Intenta de nuevo.',
      );
    }
    if (!data) {
      throw new NotFoundException('No encontramos tu perfil.');
    }
    return this.mapProfile(data);
  }

  /**
   * Cambia el teléfono y/o el tipo de documento
   */
  async updateMe(userId: string, dto: UpdateMyProfileDto): Promise<MyProfile> {
    const changes: Record<string, string> = {};
    if (dto.phone !== undefined) changes.phone = dto.phone.trim();
    if (dto.documentType !== undefined)
      changes.document_type = dto.documentType;

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No hay cambios para guardar.');
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error al actualizar el perfil ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos guardar los cambios. Intenta de nuevo.',
      );
    }
    if (!data) {
      throw new NotFoundException('No encontramos tu perfil.');
    }
    return this.mapProfile(data);
  }

  /**
   * Cambia el correo en Supabase Auth y en profiles, después de confirmar la contraseña actual.
   * El correo nuevo queda confirmado de inmediato (igual que el cambio que hace el administrador).
   */
  async updateEmail(
    userId: string,
    dto: UpdateMyEmailDto,
  ): Promise<{ message: string; email: string }> {
    const profile = await this.getMe(userId);
    const newEmail = dto.email.trim().toLowerCase();

    if (newEmail === profile.email.trim().toLowerCase()) {
      throw new BadRequestException('El correo nuevo es igual al actual.');
    }

    // 1. Confirmar la contraseña con un cliente desechable (no deja sesión en el cliente administrativo).
    //    Responde 400 y no 401: un 401 hace que el frontend intente renovar el token.
    const { error: passwordError } = await this.supabaseService
      .createAuthClient()
      .auth.signInWithPassword({
        email: profile.email,
        password: dto.currentPassword,
      });

    if (passwordError) {
      throw new BadRequestException('La contraseña actual no es correcta.');
    }

    const supabase = this.supabaseService.getClient();

    // 2. Cambiar el correo en Supabase Auth
    const { error: authError } = await supabase.auth.admin.updateUserById(
      userId,
      {
        email: newEmail,
        email_confirm: true,
      },
    );

    if (authError) {
      const code = (authError as { code?: string }).code ?? '';
      if (
        code === 'email_exists' ||
        authError.message?.toLowerCase().includes('already')
      ) {
        throw new ConflictException(
          'Este correo ya está registrado en otra cuenta.',
        );
      }
      this.logger.error(
        `Error al cambiar el correo de ${userId} en Auth: ${code} ${authError.message}`,
      );
      throw new InternalServerErrorException(
        'No pudimos cambiar tu correo. Intenta de nuevo.',
      );
    }

    // 3. Cambiar el correo en profiles; si falla, se devuelve el correo anterior en Auth
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (profileError) {
      this.logger.error(
        `Error al cambiar el correo de ${userId} en profiles: ${profileError.message}`,
      );
      const { error: revertError } = await supabase.auth.admin.updateUserById(
        userId,
        {
          email: profile.email,
          email_confirm: true,
        },
      );
      if (revertError) {
        this.logger.error(
          `Reversión: el correo de ${userId} quedó como ${newEmail} en Auth y ${profile.email} en profiles: ${revertError.message}`,
        );
      }
      if (profileError.code === '23505') {
        throw new ConflictException(
          'Este correo ya está registrado en otra cuenta.',
        );
      }
      throw new InternalServerErrorException(
        'No pudimos cambiar tu correo. Intenta de nuevo.',
      );
    }

    return {
      message:
        'Tu correo se actualizó. Úsalo la próxima vez que inicies sesión.',
      email: newEmail,
    };
  }

  private mapProfile(row: ProfileRow): MyProfile {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      documentType: row.document_type ?? null,
      documentNumber: row.document_number ?? null,
      phone: row.phone ?? null,
    };
  }
}
