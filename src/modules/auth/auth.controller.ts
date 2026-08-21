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
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un nuevo usuario tutor' })
  @ApiResponse({ status: 201, description: 'Usuario registrado exitosamente con tokens generados' })
  @ApiResponse({ status: 400, description: 'Datos de registro inválidos o incompletos' })
  @ApiResponse({ status: 409, description: 'El correo o documento ya se encuentra registrado' })
  async register(@Body() registerDto: RegisterDto) {
    return await this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión con credenciales (email y password)' })
  @ApiResponse({ status: 200, description: 'Autenticación exitosa, retorna access token y refresh token' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() loginDto: LoginDto) {
    return await this.authService.login(loginDto);
  }

  @Post('oauth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión o registrarse mediante proveedor OAuth (Google, GitHub, etc.)' })
  @ApiResponse({ status: 200, description: 'Autenticación exitosa con proveedor OAuth' })
  @ApiResponse({ status: 400, description: 'Token de proveedor inválido' })
  async oauthLogin(@Body() oauthDto: OAuthLoginDto) {
    return await this.authService.loginWithOAuth(oauthDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar Access Token mediante Refresh Token' })
  @ApiResponse({ status: 200, description: 'Tokens renovados exitosamente' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o expirado' })
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
    return await this.authService.logout(user.userId, refreshTokenDto.refreshToken);
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