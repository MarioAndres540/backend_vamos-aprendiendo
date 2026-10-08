import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LicensesService } from './licenses.service';
import { CreateLicenseDto } from './dto/create-license.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get('current')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener la licencia activa y beneficios del usuario/estudiante' })
  @ApiResponse({ status: 200, description: 'Detalle de licencia activa retornado' })
  async getCurrentLicense(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
  ) {
    return await this.licensesService.getEffectiveLicense(user.userId, studentId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear o asignar licencia (Exclusivo Administrador)' })
  @ApiResponse({ status: 201, description: 'Licencia creada exitosamente' })
  async create(@Body() dto: CreateLicenseDto) {
    return await this.licensesService.create(dto);
  }
}
