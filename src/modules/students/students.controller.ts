import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Param,
  ParseUUIDPipe,
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CreateChildDto } from './dto/create-child.dto';
import { ConsentMetaParam } from '../privacy/consent-meta.decorator';
import type { ConsentMeta } from '../privacy/privacy.constants';

@ApiTags('Students')
@Controller('students')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Guardar diagnostico inicial del estudiante',
    description:
      'Persiste las respuestas del formulario de diagnostico y marca el setup como completado en el perfil del usuario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Diagnostico guardado exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 500, description: 'Error al guardar el diagnostico' })
  async saveSetup(
    @CurrentUser() user: any,
    @Body() dto: CreateStudentSetupDto,
  ) {
    return await this.studentsService.saveSetup(user.userId, dto);
  }

  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar los estudiantes vinculados al tutor',
    description:
      'Retorna los hijos de la cuenta (tutor_students) con grado, edad, colegio y su último formulario inicial. Lo usan el dashboard del tutor y la app de Unity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Estudiantes del tutor (lista vacía si no tiene)',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 500,
    description: 'Error al consultar los estudiantes',
  })
  async findMine(@CurrentUser() user: any) {
    return await this.studentsService.findMine(user.userId);
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

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.USER, Role.TEST)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar un hijo o menor a cargo',
    description:
      'Crea el estudiante, lo vincula a la cuenta, lo matricula si tiene colegio y le asigna una licencia de prueba de 14 días. Después se debe llenar su formulario inicial (POST /assessments con studentId).',
  })
  @ApiResponse({ status: 201, description: 'Estudiante creado y vinculado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o falta la autorización del representante legal' })
  @ApiResponse({
    status: 403,
    description: 'El perfil no puede agregar estudiantes',
  })
  @ApiResponse({ status: 409, description: 'Documento ya registrado' })
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateChildDto,
    @ConsentMetaParam() consentMeta: ConsentMeta,
  ) {
    return await this.studentsService.create(user.userId, dto, consentMeta);
  }

  // Debe ir después de las rutas fijas ('mine', 'setup-status') para no capturarlas
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener un estudiante del tutor',
    description:
      'Datos del hijo seleccionado en el dashboard (grado, edad, colegio, documento y último formulario inicial).',
  })
  @ApiResponse({ status: 200, description: 'Estudiante encontrado' })
  @ApiResponse({
    status: 404,
    description: 'El estudiante no está vinculado a la cuenta',
  })
  async findOne(
    @CurrentUser() user: any,
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
  ) {
    return await this.studentsService.findOne(user.userId, id);
  }
}
