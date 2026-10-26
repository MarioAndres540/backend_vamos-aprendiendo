import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateMyEmailDto } from './dto/update-my-email.dto';

@ApiTags('Profile')
@Controller('profile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Datos personales de la cuenta (vista de Configuración)',
  })
  @ApiResponse({
    status: 200,
    description: 'Nombres, documento, teléfono y correo',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getMe(@CurrentUser() user: { userId: string }) {
    return await this.profileService.getMe(user.userId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar teléfono o tipo de documento' })
  @ApiResponse({ status: 200, description: 'Perfil actualizado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o sin cambios' })
  async updateMe(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateMyProfileDto,
  ) {
    return await this.profileService.updateMe(user.userId, dto);
  }

  @Patch('me/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar el correo de la cuenta',
    description:
      'Requiere la contraseña actual. Cambia el correo en Supabase Auth y en el perfil.',
  })
  @ApiResponse({ status: 200, description: 'Correo actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Contraseña incorrecta, correo inválido o igual al actual',
  })
  @ApiResponse({
    status: 409,
    description: 'El correo ya está registrado en otra cuenta',
  })
  async updateEmail(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateMyEmailDto,
  ) {
    return await this.profileService.updateEmail(user.userId, dto);
  }
}
