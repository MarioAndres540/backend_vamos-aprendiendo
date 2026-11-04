import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { ConsentMetaParam } from '../privacy/consent-meta.decorator';
import type { ConsentMeta } from '../privacy/privacy.constants';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  LOGIN_LIMIT,
  OAUTH_LIMIT,
  REFRESH_LIMIT,
  REGISTER_LIMIT,
} from './auth-throttle';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle(REGISTER_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un nuevo usuario tutor' })
  @ApiResponse({
    status: 201,
    description: 'Usuario registrado exitosamente con tokens generados',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos de registro inválidos o incompletos',
  })
  @ApiResponse({
    status: 409,
    description: 'El correo o documento ya se encuentra registrado',
  })
  async register(
    @Body() registerDto: RegisterDto,
    @ConsentMetaParam() consentMeta: ConsentMeta,
  ) {
    return await this.authService.register(registerDto, consentMeta);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle(LOGIN_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión con credenciales (email y password)',
  })
  @ApiResponse({
    status: 200,
    description: 'Autenticación exitosa, retorna access token y refresh token',
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() loginDto: LoginDto) {
    return await this.authService.login(loginDto);
  }

  @Post('oauth')
  @UseGuards(ThrottlerGuard)
  @Throttle(OAUTH_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Iniciar sesión o registrarse mediante proveedor OAuth (Google, GitHub, etc.)',
  })
  @ApiResponse({
    status: 200,
    description: 'Autenticación exitosa con proveedor OAuth',
  })
  @ApiResponse({ status: 400, description: 'Token de proveedor inválido' })
  async oauthLogin(
    @Body() oauthDto: OAuthLoginDto,
    @ConsentMetaParam() consentMeta: ConsentMeta,
  ) {
    return await this.authService.loginWithOAuth(oauthDto, consentMeta);
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @Throttle(REFRESH_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar Access Token mediante Refresh Token' })
  @ApiResponse({ status: 200, description: 'Tokens renovados exitosamente' })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido o expirado',
  })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return await this.authService.refreshTokens(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión e invalidar el refresh token' })
  @ApiResponse({ status: 200, description: 'Sesión cerrada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async logout(
    @CurrentUser() user: any,
    @Body() refreshTokenDto: RefreshTokenDto,
  ) {
    return await this.authService.logout(
      user.userId,
      refreshTokenDto.refreshToken,
    );
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Información del perfil obtenida' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getProfile(@CurrentUser() user: any) {
    let daysRemaining: number | null = null;
    if (user.role === Role.TEST && user.trialEndsAt) {
      const diffMs = new Date(user.trialEndsAt).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      message: 'Acceso a ruta protegida exitoso',
      user: {
        ...user,
        daysRemaining,
      },
    };
  }
}
