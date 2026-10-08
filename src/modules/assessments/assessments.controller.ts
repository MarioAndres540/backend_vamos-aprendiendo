import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AssessmentsService } from './assessments.service';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Assessments')
@Controller('assessments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enviar respuestas del formulario inicial de evaluación (cribado ≤ 10 preguntas)',
    description: 'Guarda las respuestas, calcula el puntaje/alerta y marca has_completed_setup = true.',
  })
  @ApiResponse({ status: 200, description: 'Evaluación procesada y guardada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos del formulario inválidos' })
  async submit(
    @CurrentUser() user: any,
    @Body() dto: SubmitAssessmentDto,
  ) {
    return await this.assessmentsService.submitAssessment(user.userId, dto);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener historial de evaluaciones diagnósticas' })
  @ApiResponse({ status: 200, description: 'Historial de evaluaciones retornado' })
  async getHistory(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
  ) {
    return await this.assessmentsService.getHistory(user.userId, studentId);
  }
}
