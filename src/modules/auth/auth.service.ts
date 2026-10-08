import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto, PublicRegistrationRole } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { Role } from '../../common/enums/role.enum';
import * as crypto from 'crypto';

/** Tipo de perfil usado por el frontend para decidir el destino después del login */
export type ProfileType = 'admin' | 'profesor' | 'tester' | 'tutor' | 'adulto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ==========================================
  // REGISTRO INTEGRAL (TUTOR, DOCENTE, ADULTO)
  // ==========================================

  async register(dto: RegisterDto) {
    const supabase = this.supabaseService.getClient();

    // 1. Si se registra como DOCENTE, validar pre-autorización institucional previa
    let teacherPreauthId: string | null = null;
    let targetRole: Role = Role.TEST;

    if (dto.role === PublicRegistrationRole.TEACHER) {
      if (!dto.institutionId) {
        throw new BadRequestException('Debes seleccionar la institución educativa donde laboras.');
      }

      const { data: preauthRecord, error: preauthError } = await supabase
        .from('institution_preauth_teachers')
        .select('id, is_registered')
        .eq('institution_id', dto.institutionId)
        .eq('document_number', dto.documentNumber.trim())
        .ilike('email', dto.email.trim())
        .single();

      if (preauthError || !preauthRecord) {
        throw new ForbiddenException(
          'No figuras como docente autorizado por esta institución. Comunícate con tu centro educativo.',
        );
      }

      if (preauthRecord.is_registered) {
        throw new BadRequestException('Este docente ya completó su registro previamente. Por favor inicia sesión.');
      }

      teacherPreauthId = preauthRecord.id;
      targetRole = Role.TEACHER;
    } else if (dto.role === PublicRegistrationRole.USER) {
      targetRole = Role.USER;
    }

    const trialEndsAt =
      targetRole === Role.TEST
        ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        : null;

    // 2. Crear usuario en Supabase Auth (cliente desechable: signUp deja una sesión que no debe
    //    contaminar el cliente administrativo usado para los inserts siguientes)
    const { data: authData, error: authError } = await this.supabaseService.createAuthClient().auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (authError || !authData.user) {
      throw this.mapSignUpError(authError, dto.email);
    }

    const userId = authData.user.id;
    // Estudiantes creados en este registro, para poder revertirlos si algo falla
    const createdStudentIds: string[] = [];

    // Si falla cualquier paso posterior, se deshace todo lo creado y se responde con un mensaje claro
    const failRegistration = async (
      step: string,
      error: { message?: string; code?: string } | null,
      userMessage: string,
    ): Promise<never> => {
      this.logger.error(`Registro de ${dto.email} falló en "${step}": ${error?.code ?? ''} ${error?.message ?? ''}`);
      await this.rollbackRegistration(userId, createdStudentIds);
      if (error?.code === '23505') {
        throw new ConflictException(
          'Ya existe una cuenta registrada con estos datos (correo o número de documento). Inicia sesión o recupera tu contraseña.',
        );
      }
      throw new InternalServerErrorException(userMessage);
    };

    // 3. Crear registro central en profiles
    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      email: dto.email,
      first_name: dto.firstName,
      last_name: dto.lastName,
      document_type: dto.documentType,
      document_number: dto.documentNumber,
      age: dto.age,
      phone: dto.phone,
      accepted_terms: dto.acceptedTerms,
      role: targetRole,
      trial_ends_at: trialEndsAt,
      institution_id: dto.institutionId || null,
      has_completed_setup: false,
      is_active: true,
    });

    if (profileError) {
      return failRegistration('profiles', profileError, 'No pudimos crear tu perfil. Intenta de nuevo en unos minutos.');
    }

    // 4. Si es DOCENTE: crear registros en teachers y teacher_institutions
    if (targetRole === Role.TEACHER && dto.institutionId) {
      const { data: teacherRecord, error: teacherError } = await supabase
        .from('teachers')
        .insert({
          profile_id: userId,
          professional_license: dto.professionalLicense || null,
          is_active: true,
        })
        .select()
        .single();

      if (teacherError || !teacherRecord) {
        return failRegistration('teachers', teacherError, 'No pudimos registrar tu perfil docente. Intenta de nuevo en unos minutos.');
      }

      const { error: teacherInstitutionError } = await supabase.from('teacher_institutions').insert({
        teacher_id: teacherRecord.id,
        institution_id: dto.institutionId,
        is_active: true,
      });

      if (teacherInstitutionError) {
        return failRegistration(
          'teacher_institutions',
          teacherInstitutionError,
          'No pudimos vincularte con tu institución. Intenta de nuevo en unos minutos.',
        );
      }
    }

    // 5. Si es TUTOR y agregó hijos: Registrar estudiantes, tutor_students y matrículas
    if (dto.children && dto.children.length > 0) {
      for (const child of dto.children) {
        const childName = `${child.firstName} ${child.lastName}`.trim();
        const childFailMessage = `No pudimos registrar al estudiante ${childName}. Revisa sus datos e intenta de nuevo.`;

        // Insertar estudiante
        const { data: studentRecord, error: studentError } = await supabase
          .from('students')
          .insert({
            first_name: child.firstName,
            last_name: child.lastName,
            document_type: child.documentType,
            document_number: child.documentNumber,
            birth_date: child.birthDate,
            age: child.age,
            grade: child.grade || null,
            institution_id: child.institutionId || null,
            is_active: true,
          })
          .select()
          .single();

        if (studentError || !studentRecord) {
          return failRegistration('students', studentError, childFailMessage);
        }
        createdStudentIds.push(studentRecord.id);

        // Vincular Tutor ↔ Estudiante
        const { error: tutorLinkError } = await supabase.from('tutor_students').insert({
          tutor_profile_id: userId,
          student_id: studentRecord.id,
          relationship: 'hijo',
          is_primary_tutor: true,
        });

        if (tutorLinkError) {
          return failRegistration('tutor_students', tutorLinkError, childFailMessage);
        }

        // Si el hijo está vinculado a una institución, registrar matrícula
        if (child.institutionId) {
          const { error: enrollmentError } = await supabase.from('student_enrollments').insert({
            student_id: studentRecord.id,
            institution_id: child.institutionId,
            grade: child.grade || '1° Primaria',
            is_active: true,
          });

          if (enrollmentError) {
            return failRegistration('student_enrollments', enrollmentError, childFailMessage);
          }
        }

        // Crear licencia de prueba (Trial 14d) para el estudiante
        const { error: studentLicenseError } = await supabase.from('licenses').insert({
          plan_type: 'trial',
          origin: 'personal',
          owner_profile_id: userId,
          student_id: studentRecord.id,
          starts_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          is_active: true,
        });

        if (studentLicenseError) {
          return failRegistration('licenses (estudiante)', studentLicenseError, childFailMessage);
        }
      }
    }

    // 6. Generar licencia de prueba (Trial 14d) para la cuenta del titular
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const { error: licenseError } = await supabase.from('licenses').insert({
      plan_type: targetRole === Role.TEACHER ? 'pro' : 'trial',
      origin: targetRole === Role.TEACHER ? 'institucional' : 'personal',
      owner_profile_id: userId,
      institution_id: dto.institutionId || null,
      starts_at: startsAt.toISOString(),
      expires_at: targetRole === Role.TEACHER ? null : expiresAt.toISOString(),
      is_active: true,
    });

    if (licenseError) {
      return failRegistration('licenses', licenseError, 'No pudimos activar tu periodo de prueba. Intenta de nuevo en unos minutos.');
    }

    // 7. Marcar la pre-autorización docente como usada solo cuando todo el registro fue exitoso
    if (teacherPreauthId) {
      const { error: preauthUpdateError } = await supabase
        .from('institution_preauth_teachers')
        .update({ is_registered: true })
        .eq('id', teacherPreauthId);

      if (preauthUpdateError) {
        // La cuenta ya quedó creada: no se revierte, solo se deja constancia para revisión del administrador
        this.logger.warn(
          `No se pudo marcar la pre-autorización ${teacherPreauthId} como registrada: ${preauthUpdateError.message}`,
        );
      }
    }

    // El registro no inicia sesión: la persona debe iniciar sesión, y en el login se decide su destino
    // (dashboard de profesor, panel admin, formulario inicial o dashboard de usuarios)
    return {
      message: 'Cuenta creada correctamente. Inicia sesión para continuar.',
      user: {
        id: userId,
        email: dto.email,
        role: targetRole,
      },
    };
  }

  /**
   * Determina el tipo de perfil a partir del rol. Tutor y adulto comparten el rol 'usuario':
   * es tutor si tiene al menos un estudiante vinculado en 'tutor_students'.
   */
  async resolveProfileType(userId: string, role: Role): Promise<ProfileType> {
    if (role === Role.ADMIN) return 'admin';
    if (role === Role.TEACHER) return 'profesor';
    if (role === Role.TEST) return 'tester';

    const supabase = this.supabaseService.getClient();
    const { count, error } = await supabase
      .from('tutor_students')
      .select('id', { count: 'exact', head: true })
      .eq('tutor_profile_id', userId);

    if (error) {
      // No bloquea el login: sin poder confirmarlo se trata como adulto independiente
      this.logger.warn(`No se pudo verificar si ${userId} es tutor: ${error.message}`);
      return 'adulto';
    }
    return (count ?? 0) > 0 ? 'tutor' : 'adulto';
  }

  /**
   * Traduce los errores de Supabase Auth en el registro a mensajes claros para el usuario.
   * El detalle técnico solo se deja en el log del servidor.
   */
  private mapSignUpError(error: { message?: string; code?: string } | null, email: string): HttpException {
    const code = error?.code ?? '';
    const message = (error?.message ?? '').toLowerCase();

    if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) {
      return new ConflictException(
        'Este correo ya está registrado. Inicia sesión o recupera tu contraseña.',
      );
    }
    if (code === 'weak_password' || message.includes('password')) {
      return new BadRequestException(
        'La contraseña no cumple los requisitos de seguridad. Usa al menos 6 caracteres combinando letras y números.',
      );
    }
    if (code === 'email_address_invalid' || (message.includes('invalid') && message.includes('email'))) {
      return new BadRequestException('El correo electrónico no es válido. Revísalo e intenta de nuevo.');
    }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || message.includes('rate limit')) {
      return new BadRequestException('Se hicieron demasiados intentos de registro. Espera unos minutos e intenta de nuevo.');
    }

    this.logger.error(`Supabase Auth rechazó el registro de ${email}: ${code} ${error?.message ?? 'sin detalle'}`);
    return new InternalServerErrorException('No pudimos crear tu cuenta. Intenta de nuevo en unos minutos.');
  }

  /**
   * Deshace un registro incompleto: estudiantes creados, perfil (y sus registros en cascada) y usuario de Auth.
   * Si algún paso falla se registra en el log, porque el correo quedaría bloqueado para un nuevo registro.
   */
  private async rollbackRegistration(userId: string, studentIds: string[]): Promise<void> {
    const supabase = this.supabaseService.getClient();

    if (studentIds.length > 0) {
      const { error } = await supabase.from('students').delete().in('id', studentIds);
      if (error) {
        this.logger.error(`Reversión: no se pudieron eliminar los estudiantes ${studentIds.join(', ')}: ${error.message}`);
      }
    }

    const { error: profileDeleteError } = await supabase.from('profiles').delete().eq('id', userId);
    if (profileDeleteError) {
      this.logger.error(`Reversión: no se pudo eliminar el perfil ${userId}: ${profileDeleteError.message}`);
    }

    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      this.logger.error(
        `Reversión: no se pudo eliminar el usuario de Auth ${userId} (${authDeleteError.message}). ` +
          'El correo queda bloqueado hasta eliminarlo manualmente en Supabase. Verifica que SUPABASE_SERVICE_ROLE_KEY sea la llave secreta.',
      );
    }
  }

  // ==========================================
  // INICIO DE SESIÓN Y RESOLUCIÓN DE LICENCIA
  // ==========================================

  async login(dto: LoginDto) {
    const supabase = this.supabaseService.getClient();

    // Cliente desechable: la sesión del usuario no debe quedar en el cliente administrativo compartido
    const { data, error } = await this.supabaseService.createAuthClient().auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Obtener información del perfil
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, trial_ends_at, is_active, has_completed_setup, institution_id, first_name, last_name')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      throw new UnauthorizedException('No se encontró el perfil de usuario asociado');
    }

    if (profile.is_active === false) {
      throw new UnauthorizedException('Tu cuenta ha sido desactivada. Por favor contacta al administrador.');
    }

    const role: Role = (profile.role as Role) || Role.TEST;
    const trialEndsAt = profile.trial_ends_at || null;
    const isActive = profile.is_active !== false;
    const hasCompletedSetup = profile.has_completed_setup === true;

    // Calcular estado de licencia activa
    const licenseInfo = await this.resolveActiveLicense(data.user.id);

    // Tipo de perfil: define a dónde se envía al usuario después del login
    const profileType = await this.resolveProfileType(data.user.id, role);

    const tokenPair = await this.generateTokenPair(
      data.user.id,
      data.user.email || dto.email,
      role,
      trialEndsAt,
      isActive,
      hasCompletedSetup,
    );

    return {
      ...tokenPair,
      user: { ...tokenPair.user, profileType },
      profileType,
      license: licenseInfo,
      profile: {
        firstName: profile.first_name,
        lastName: profile.last_name,
        institutionId: profile.institution_id,
      },
    };
  }

  // ==========================================
  // AUTENTICACIÓN SOCIAL (OAuth 2.0)
  // ==========================================

  async loginWithOAuth(dto: OAuthLoginDto) {
    const supabase = this.supabaseService.getClient();

    // Cliente desechable: la sesión del usuario no debe quedar en el cliente administrativo compartido
    const { data, error } = await this.supabaseService.createAuthClient().auth.signInWithIdToken({
      provider: dto.provider,
      token: dto.idToken || '',
      access_token: dto.accessToken,
    });

    if (error || !data.user) {
      throw new UnauthorizedException(`Error de autenticación con ${dto.provider}: ${error?.message}`);
    }

    const userId = data.user.id;
    const email = data.user.email || '';

    // Verificar si ya existe perfil
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, trial_ends_at, is_active, has_completed_setup')
      .eq('id', userId)
      .single();

    let userRole: Role = Role.TEST;
    let trialEndsAt: string | null = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    let isActive = true;
    let hasCompletedSetup = false;

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
        role: userRole,
        trial_ends_at: trialEndsAt,
        has_completed_setup: false,
        is_active: true,
      });

      // Crear licencia de prueba inicial
      await supabase.from('licenses').insert({
        plan_type: 'trial',
        origin: 'personal',
        owner_profile_id: userId,
        starts_at: new Date().toISOString(),
        expires_at: trialEndsAt,
        is_active: true,
      });
    } else {
      if (profile.is_active === false) {
        throw new UnauthorizedException('Tu cuenta ha sido desactivada. Por favor contacta al administrador.');
      }
      userRole = (profile.role as Role) || Role.TEST;
      trialEndsAt = profile.trial_ends_at || null;
      isActive = profile.is_active !== false;
      hasCompletedSetup = profile.has_completed_setup === true;
    }

    const licenseInfo = await this.resolveActiveLicense(userId);
    const tokenPair = await this.generateTokenPair(userId, email, userRole, trialEndsAt, isActive, hasCompletedSetup);

    return {
      ...tokenPair,
      license: licenseInfo,
    };
  }

  // ==========================================
  // ROTACIÓN DE REFRESH TOKENS (SHA-256)
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

    const { data: tokenRecord, error } = await supabase
      .from('refresh_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .single();

    if (error || !tokenRecord) {
      throw new UnauthorizedException('Refresh token no reconocido');
    }

    // Sesión (dispositivo) a la que pertenece el token. Una cuenta puede tener varias abiertas a la vez
    // (ej. app de Unity y web); los tokens anteriores a la migración no traen session_id.
    const sessionId: string | null = tokenRecord.session_id ?? payload.sid ?? null;

    // Detección de reutilización: se cierra SOLO la sesión de ese dispositivo, nunca las demás
    if (tokenRecord.is_revoked) {
      if (sessionId) {
        await supabase.from('refresh_tokens').update({ is_revoked: true }).eq('session_id', sessionId);
      }
      this.logger.warn(`Reutilización de refresh token del usuario ${payload.sub} (sesión ${sessionId ?? 'sin id'}); se cerró solo esa sesión.`);
      throw new UnauthorizedException('Tu sesión en este dispositivo se cerró por seguridad. Inicia sesión de nuevo.');
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    // Revocar token usado
    await supabase.from('refresh_tokens').update({ is_revoked: true }).eq('id', tokenRecord.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, trial_ends_at, is_active, has_completed_setup')
      .eq('id', payload.sub)
      .single();

    if (profile && profile.is_active === false) {
      throw new UnauthorizedException('Tu cuenta ha sido desactivada');
    }

    const currentRole: Role = (profile?.role as Role) || payload.role || Role.TEST;
    const currentTrialEndsAt = profile?.trial_ends_at ?? payload.trialEndsAt ?? null;
    const currentIsActive = profile ? profile.is_active !== false : true;
    const hasCompletedSetup = profile ? profile.has_completed_setup === true : false;

    // El token nuevo continúa la misma sesión (mismo dispositivo)
    return await this.generateTokenPair(
      payload.sub,
      payload.email,
      currentRole,
      currentTrialEndsAt,
      currentIsActive,
      hasCompletedSetup,
      sessionId ?? undefined,
    );
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
  // HELPERS PRIVADOS
  // ==========================================

  private async resolveActiveLicense(userId: string) {
    const supabase = this.supabaseService.getClient();
    const now = new Date();

    const { data: licenses } = await supabase
      .from('licenses')
      .select('plan_type, origin, expires_at, starts_at, is_active')
      .eq('owner_profile_id', userId)
      .eq('is_active', true);

    if (!licenses || licenses.length === 0) {
      return { plan: 'free', origin: 'personal', daysRemaining: null, isActive: true };
    }

    // 1. Pro
    const pro = licenses.find((l) => l.plan_type === 'pro' && (!l.expires_at || new Date(l.expires_at) > now));
    if (pro) {
      const days = pro.expires_at
        ? Math.max(0, Math.ceil((new Date(pro.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      return { plan: 'pro', origin: pro.origin, daysRemaining: days, isActive: true };
    }

    // 2. Trial
    const trial = licenses.find((l) => l.plan_type === 'trial');
    if (trial) {
      const expDate = trial.expires_at
        ? new Date(trial.expires_at)
        : new Date(new Date(trial.starts_at).getTime() + 14 * 24 * 60 * 60 * 1000);
      const days = Math.max(0, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      return { plan: 'trial', origin: trial.origin, daysRemaining: days, isActive: days > 0 };
    }

    return { plan: 'free', origin: 'personal', daysRemaining: null, isActive: true };
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    role: Role = Role.TEST,
    trialEndsAt: string | null = null,
    isActive: boolean = true,
    hasCompletedSetup: boolean = false,
    // Sesión (dispositivo) que continúa; en un inicio de sesión nuevo se crea una
    sessionId: string = crypto.randomUUID(),
  ) {
    const payload = {
      sub: userId,
      email,
      role,
      trialEndsAt,
      isActive,
      hasCompletedSetup,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET') || 'default_secret_key_vamos_aprendiendo',
      expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') || '15m') as any,
    });

    // 'sid' identifica la sesión y 'jti' hace único cada token: sin ellos, dos inicios de sesión en el
    // mismo segundo (ej. Unity y web) generaban el mismo token y uno se tomaba como reutilización del otro
    const refreshToken = this.jwtService.sign(
      { ...payload, sid: sessionId, jti: crypto.randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret',
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
      },
    );

    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const supabase = this.supabaseService.getClient();
    const tokenRow = {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      is_revoked: false,
    };
    const { error: insertError } = await supabase
      .from('refresh_tokens')
      .insert({ ...tokenRow, session_id: sessionId });

    if (insertError) {
      // Compatibilidad: sin la migración 20261007_refresh_tokens_session_family.sql la columna no existe
      const missingSessionColumn = insertError.code === 'PGRST204' || /session_id/i.test(insertError.message ?? '');
      if (!missingSessionColumn) {
        this.logger.error(`No se pudo guardar el refresh token de ${userId}: ${insertError.message}`);
        throw new InternalServerErrorException('No pudimos iniciar tu sesión. Intenta de nuevo en unos minutos.');
      }
      this.logger.warn('refresh_tokens.session_id no existe: aplica la migración 20261007_refresh_tokens_session_family.sql');
      const { error: fallbackError } = await supabase.from('refresh_tokens').insert(tokenRow);
      if (fallbackError) {
        this.logger.error(`No se pudo guardar el refresh token de ${userId}: ${fallbackError.message}`);
        throw new InternalServerErrorException('No pudimos iniciar tu sesión. Intenta de nuevo en unos minutos.');
      }
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: userId,
        email,
        role,
        isActive,
        hasCompletedSetup,
      },
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
