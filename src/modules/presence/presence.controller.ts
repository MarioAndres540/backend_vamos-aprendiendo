import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PresenceService } from './presence.service';
import { StartAppSessionDto } from './dto/start-app-session.dto';
import { EndAppSessionDto } from './dto/end-app-session.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

// Guía de integración para la app de Unity: backend/docs/unity-app-sessions.md
@ApiTags('Presence')
@ApiBearerAuth()
@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Abrir una sesión de uso de la app (al iniciar la app o volver al primer plano)' })
  @ApiResponse({ status: 201, description: 'Sesión creada: devuelve sessionId e intervalo de latidos' })
  @ApiResponse({ status: 400, description: 'El estudiante no está vinculado a la cuenta' })
  startSession(@Req() req: any, @Body() dto: StartAppSessionDto) {
    return this.presenceService.startSession(req.user.userId, dto);
  }

  @Post('sessions/:sessionId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Latido periódico (cada heartbeatIntervalSeconds) para mantener la sesión activa' })
  @ApiResponse({ status: 404, description: 'SESSION_NOT_FOUND: la sesión no existe o no es de esta cuenta' })
  @ApiResponse({ status: 409, description: 'SESSION_ENDED: la sesión terminó o expiró; abrir una nueva' })
  heartbeat(@Req() req: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.presenceService.heartbeat(req.user.userId, sessionId);
  }

  @Post('sessions/:sessionId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar la sesión (al cerrar la app o cerrar sesión). Idempotente.' })
  endSession(
    @Req() req: any,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: EndAppSessionDto,
  ) {
    return this.presenceService.endSession(req.user.userId, sessionId, dto.reason);
  }

  @Get('me')
  @ApiOperation({ summary: 'Estado de la app de Unity para la cuenta actual (dashboard del tutor / adulto)' })
  getMyAppStatus(@Req() req: any) {
    return this.presenceService.getAppStatus(req.user.userId);
  }

  @Get('status/:userId')
  @UseGuards(RolesGuard)
  @Roles(Role.TEACHER, Role.ADMIN)
  @ApiOperation({ summary: 'Estado de la app de Unity de un usuario (profesor / administrador)' })
  getStatus(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.presenceService.getAppStatus(userId);
  }
}
