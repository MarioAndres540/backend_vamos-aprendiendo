import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminQueryUsersDto } from './dto/admin-query-users.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { AdminUpdateEmailDto } from './dto/admin-update-email.dto';
import { AdminExtendTrialDto } from './dto/admin-extend-trial.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Listar todos los usuarios con paginación, filtros por rol y búsqueda' })
  @ApiResponse({ status: 200, description: 'Listado de usuarios obtenido exitosamente' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Requiere permisos de Administrador' })
  async findAll(@Query() query: AdminQueryUsersDto) {
    return await this.adminService.findAll(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Obtener información detallada de un usuario por su ID' })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Detalles del usuario obtenidos' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return await this.adminService.findById(id);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Modificar datos personales, rol o estado activo de un usuario' })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Usuario actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos de actualización inválidos' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return await this.adminService.updateUser(id, dto);
  }

  @Patch('users/:id/email')
  @ApiOperation({ summary: 'Modificar correo electrónico del usuario (Auth y Perfil)' })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Correo actualizado exitosamente' })
  @ApiResponse({ status: 400, description: 'Correo inválido o ya en uso' })
  async updateEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateEmailDto,
  ) {
    return await this.adminService.updateEmail(id, dto);
  }

  @Patch('users/:id/extend-trial')
  @ApiOperation({ summary: 'Extender el periodo de prueba para un usuario (Rol Test)' })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Periodo de prueba extendido' })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos' })
  async extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminExtendTrialDto,
  ) {
    return await this.adminService.extendTrial(id, dto);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un usuario del sistema (Auth, Perfil y Sesiones)' })
  @ApiParam({ name: 'id', description: 'UUID del usuario' })
  @ApiResponse({ status: 200, description: 'Usuario eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return await this.adminService.deleteUser(id);
  }
}
