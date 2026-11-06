import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ActiveAccessGuard } from '../../common/guards/active-access.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TelemetryService } from './telemetry.service';
import { QueryTelemetryDto } from './dto/query-telemetry.dto';
import { QueryXpDto } from './dto/query-xp.dto';
import { RecordExerciseDto } from './dto/record-exercise.dto';
import { ImportExercisesDto } from './dto/import-exercises.dto';
import { ClaimXpDto } from './dto/claim-xp.dto';
import { UpdateLevelDto } from './dto/update-level.dto';

// Telemetría de la app de Unity (tablas de las migraciones 20261001_unity_telemetry_cognitive_dashboards y
// 20261031_exercise_attempts_and_xp). Contrato para Unity: backend/docs/unity-exercises.md
@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Post('exercises')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, ActiveAccessGuard)
  // La cuenta de estudiante juega en el colegio: registra en el contexto escolar (spec 0001 CTX-01)
  @Roles(Role.USER, Role.TEST, Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary:
      'Registrar un intento de ejercicio (letra o número) y entregar XP si queda aprobado por primera vez',
    description:
      'Idempotente por clientAttemptId. El backend decide si aprobó (cobertura ≥ 85 % y exactitud ≥ 97 %, reward_rules) y registra intento y XP en una sola transacción. Un ejercicio da XP una sola vez por estudiante.',
  })
  @ApiResponse({
    status: 200,
    description:
      'passed, awarded, xpAwarded, totalXp, attemptNumber, alreadyCompleted y duplicate (reenvío del mismo intento)',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o falta studentId',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  @ApiResponse({
    status: 404,
    description: 'El ejercicio no existe o no está disponible',
  })
  recordExercise(
    @CurrentUser() user: { userId: string },
    @Body() dto: RecordExerciseDto,
  ) {
    return this.telemetryService.recordExercise(user.userId, dto);
  }

  @Post('exercises/import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, ActiveAccessGuard)
  // La cuenta de estudiante juega en el colegio: registra en el contexto escolar (spec 0001 CTX-01)
  @Roles(Role.USER, Role.TEST, Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary:
      'Importar los ejercicios que el dispositivo ya tenía completados antes de enviarse al backend',
    description:
      'Se registran una vez como importados (sin cobertura ni exactitud) y dan el XP de la regla exercise_imported. Idempotente: lo que ya está aprobado se omite.',
  })
  @ApiResponse({
    status: 200,
    description: 'imported, skipped, unknown, xpAwarded y totalXp',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o falta studentId',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  importExercises(
    @CurrentUser() user: { userId: string },
    @Body() dto: ImportExercisesDto,
  ) {
    return this.telemetryService.importExercises(user.userId, dto);
  }

  @Post('xp/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, ActiveAccessGuard)
  @Roles(Role.USER, Role.TEST, Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary: 'Cobrar en el cofre el XP de los ejercicios aprobados',
    description:
      'La experiencia se entrega al abrir el cofre en el juego, no al aprobar el ejercicio. Marca como cobrado el XP de esos ejercicios; idempotente.',
  })
  @ApiResponse({
    status: 200,
    description: 'claimed (filas cobradas) y xpClaimed',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o falta studentId',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  claimXp(
    @CurrentUser() user: { userId: string },
    @Body() dto: ClaimXpDto,
  ) {
    return this.telemetryService.claimXp(user.userId, dto);
  }

  @Get('level')
  @ApiOperation({
    summary: 'Nivel del jugador y si ya completó todas las actividades del nivel 1',
  })
  @ApiResponse({
    status: 200,
    description: 'level, portalPassed, level1Completed, completedExercises y totalExercises',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  getLevel(
    @CurrentUser() user: { userId: string },
    @Query() query: QueryXpDto,
  ) {
    return this.telemetryService.getLevel(user.userId, query.studentId);
  }

  @Put('level')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, ActiveAccessGuard)
  @Roles(Role.USER, Role.TEST, Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary: 'Registrar que el jugador cruzó el portal o llegó al nivel 2',
    description:
      'El nivel nunca baja y solo avanza si el estudiante cobró la experiencia de todas las actividades del nivel 1. Idempotente.',
  })
  @ApiResponse({ status: 200, description: 'El nivel guardado' })
  @ApiResponse({
    status: 403,
    description: 'Faltan actividades por completar o el estudiante no está vinculado',
  })
  updateLevel(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateLevelDto,
  ) {
    return this.telemetryService.updateLevel(user.userId, dto);
  }

  @Get('route-progress')
  @ApiOperation({
    summary:
      'Progreso por ruta de aprendizaje (Matemáticas, Escritura): completadas, en progreso y pendientes',
  })
  @ApiResponse({
    status: 200,
    description:
      'Rutas con totales y los ids de ejercicios completados; hasData es false si la app aún no envió nada',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  getRouteProgress(
    @CurrentUser() user: { userId: string },
    @Query() query: QueryTelemetryDto,
  ) {
    return this.telemetryService.getRouteProgress(user.userId, query.studentId);
  }

  @Get('xp')
  @ApiOperation({
    summary: 'Experiencia (XP) acumulada y recompensas recientes',
  })
  @ApiResponse({
    status: 200,
    description: 'totalXp, rewardsCount e historial',
  })
  @ApiResponse({
    status: 403,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  getXp(@CurrentUser() user: { userId: string }, @Query() query: QueryXpDto) {
    return this.telemetryService.getXp(
      user.userId,
      query.studentId,
      query.limit ?? 20,
    );
  }

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
