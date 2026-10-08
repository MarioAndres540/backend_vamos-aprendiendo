import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InstitutionsService } from './institutions.service';
import { PreauthCheckDto } from './dto/preauth-check.dto';
import { QueryInstitutionsDto } from './dto/query-institutions.dto';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Institutions')
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly institutionsService: InstitutionsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar instituciones habilitadas (públicas y privadas)' })
  @ApiResponse({ status: 200, description: 'Listado de instituciones retornado' })
  async findAll(@Query() query: QueryInstitutionsDto) {
    return await this.institutionsService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalle de una institución por ID' })
  @ApiResponse({ status: 200, description: 'Detalle de la institución retornado' })
  @ApiResponse({ status: 404, description: 'Institución no encontrada' })
  async findById(@Param('id') id: string) {
    return await this.institutionsService.findById(id);
  }

  @Post('preauth-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar si un docente está pre-autorizado por la institución' })
  @ApiResponse({ status: 200, description: 'Docente pre-autorizado' })
  @ApiResponse({ status: 403, description: 'No autorizado por la institución' })
  @ApiResponse({ status: 400, description: 'Docente ya registrado' })
  async checkTeacherPreauth(@Body() dto: PreauthCheckDto) {
    return await this.institutionsService.checkTeacherPreauth(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una nueva institución (Exclusivo Administrador)' })
  @ApiResponse({ status: 201, description: 'Institución creada exitosamente' })
  async create(@Body() dto: CreateInstitutionDto) {
    return await this.institutionsService.create(dto);
  }
}
