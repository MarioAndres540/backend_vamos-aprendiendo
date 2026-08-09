import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ==========================================
  // REGISTRO Y LOGIN TRADICIONAL
  // ==========================================

  async register(dto: RegisterDto) {
    const supabase = this.supabaseService.getClient();

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (authError || !authData.user) {
      throw new BadRequestException(`Error en registro: ${authError?.message}`);
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      id: authData.user.id,
      email: dto.email,
      first_name: dto.firstName,
      last_name: dto.lastName,
      document_type: dto.documentType,
      document_number: dto.documentNumber,
      age: dto.age,
      phone: dto.phone,
      accepted_terms: dto.acceptedTerms,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new BadRequestException(`Error al crear perfil: ${profileError.message}`);
    }

    return await this.generateTokenPair(authData.user.id, dto.email);
  }

  async login(dto: LoginDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return await this.generateTokenPair(data.user.id, data.user.email || dto.email);
  }

  // ==========================================
  // AUTENTICACIÓN SOCIAL (OAuth 2.0)
  // ==========================================

  async loginWithOAuth(dto: OAuthLoginDto) {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: dto.provider,
      token: dto.idToken || '',
      access_token: dto.accessToken,
    });

    if (error || !data.user) {
      throw new UnauthorizedException(`Error de autenticación con ${dto.provider}: ${error?.message}`);
    }

    const userId = data.user.id;
    const email = data.user.email || '';

    // Verificar si ya existe perfil registrado para el usuario OAuth
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    // Si no existe perfil, creamos un registro inicial a partir del metadata
    if (!profile) {
      const metadata = data.user.user_metadata || {};
      const fullName = metadata.full_name || metadata.name || 'Usuario OAuth';
      const [firstName, ...lastNameParts] = fullName.split(' ');

      await supabase.from('profiles').insert({
        id: userId,
        email: email,
        first_name: firstName || 'Usuario',
        last_name: lastNameParts.join(' ') || 'Social',
        document_type: 'CC',
        document_number: `OAUTH-${userId.substring(0, 8)}`,
        age: 18,
        phone: metadata.phone || '+0000000000',
        accepted_terms: true,
      });
    }

    return await this.generateTokenPair(userId, email);
  }

  // ==========================================
  // RENOVACIÓN DE REFRESH TOKENS (ROTACIÓN + HASH SHA-256)
  // ==========================================

  async refreshTokens(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret',
      });
    } catch (err) {
      throw new UnauthorizedException('Sesión expirada o refresh token inválido');
    }

    const supabase = this.supabaseService.getClient();
    const tokenHash = this.hashToken(refreshToken);

    // Buscar el token específico por su HASH
    const { data: tokenRecord, error } = await supabase
      .from('refresh_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .single();

    if (error || !tokenRecord) {
      throw new UnauthorizedException('Refresh token no reconocido');
    }

    // Detección de Reutilización de Tokens (Token Reuse Detection)
    if (tokenRecord.is_revoked) {
      // Revocar TODOS los tokens del usuario por seguridad
      await supabase
        .from('refresh_tokens')
        .update({ is_revoked: true })
        .eq('user_id', payload.sub);

      throw new UnauthorizedException('Intento de reutilización de token detectado. Sesiones cerradas por seguridad.');
    }

    // Verificar si el token ya expiró en BD
    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    // Revocar el token actual (Rotación estricta)
    await supabase
      .from('refresh_tokens')
      .update({ is_revoked: true })
      .eq('id', tokenRecord.id);

    // Generar un nuevo par de tokens
    return await this.generateTokenPair(payload.sub, payload.email);
  }

  async logout(userId: string, refreshToken: string) {
    const supabase = this.supabaseService.getClient();
    const tokenHash = this.hashToken(refreshToken);

    await supabase
      .from('refresh_tokens')
      .update({ is_revoked: true })
      .eq('user_id', userId)
      .eq('token_hash', tokenHash);

    return { message: 'Sesión cerrada exitosamente' };
  }

  // ==========================================
  // HELPER INTERNO: GENERACIÓN Y PERSISTENCIA DE TOKENS
  // ==========================================

  private async generateTokenPair(userId: string, email: string) {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET') || 'default_secret_key_vamos_aprendiendo',
      expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') || '15m') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret',
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
    });

    // Guardar HASH SHA-256 del Refresh Token en Supabase
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const supabase = this.supabaseService.getClient();
    await supabase.from('refresh_tokens').insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      is_revoked: false,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutos en segundos
      user: { id: userId, email },
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}