import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TelemetryService } from './telemetry.service';
import { QueryTelemetryDto } from './dto/query-telemetry.dto';

// Lectura de la telemetría que guarda la app de Unity (tablas de la migración 20261001_unity_telemetry_cognitive_dashboards)
@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Get('progress')
  @ApiOperation({
    summary: 'Progreso por categoría cognitiva (pestaña Actividades)',
  })
  @ApiResponse({
    status: 200,
    description: 'Las 7 categorías con nivel, puntos y si ya se jugaron',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  getProgress(
    @CurrentUser() user: { userId: string },
    @Query() query: QueryTelemetryDto,
  ) {
    return this.telemetryService.getProgress(user.userId, query.studentId);
  }

  @Get('performance')
  @ApiOperation({
    summary:
      'Desempeño en el juego frente a lo esperado para la edad (pestaña Analíticas)',
  })
  @ApiResponse({
    status: 200,
    description: 'Promedios de trazos y operaciones, rangos esperados y avisos',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  getPerformance(
    @CurrentUser() user: { userId: string },
    @Query() query: QueryTelemetryDto,
  ) {
    return this.telemetryService.getPerformance(
      user.userId,
      query.studentId,
      query.days ?? 30,
    );
  }
}
