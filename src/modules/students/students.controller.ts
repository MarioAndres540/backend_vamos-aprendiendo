import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { CreateStudentSetupDto } from './dto/create-student-setup.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Students')
@Controller('students')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) { }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Guardar diagnostico inicial del estudiante',
    description:
      'Persiste las respuestas del formulario de diagnostico y marca el setup como completado en el perfil del usuario.',
  })
  @ApiResponse({ status: 200, description: 'Diagnostico guardado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 500, description: 'Error al guardar el diagnostico' })
  async saveSetup(
    @CurrentUser() user: any,
    @Body() dto: CreateStudentSetupDto,
  ) {
    return await this.studentsService.saveSetup(user.userId, dto);
  }

  @Get('setup-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificar si el usuario ya completo el diagnostico inicial',
    description:
      'Retorna hasCompletedSetup: true/false. Usado al login para decidir si redirigir al formulario o al dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Estado de setup retornado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getSetupStatus(@CurrentUser() user: any) {
    return await this.studentsService.getSetupStatus(user.userId);
  }
}
