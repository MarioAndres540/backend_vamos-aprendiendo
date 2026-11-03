import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TeacherService } from './teacher.service';
import { TeacherDashboardResponseDto } from './dto/teacher-institution-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ActiveAccessGuard } from '../../common/guards/active-access.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@ApiTags('Teacher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ActiveAccessGuard)
@Roles(Role.TEACHER)
@Controller('teacher')

export class TeacherController {

    constructor(private readonly teacherService: TeacherService) { }

    @Get('dashboard')
    @ApiOperation({
        summary: 'Obtener datos institucionales y lista de estudiantes del docente autenticado',
    })
    @ApiResponse({
        status: 200,
        description: 'Dashboard institucional obtenido exitosamente',
        type: TeacherDashboardResponseDto,
    })
    @ApiResponse({ status: 401, description: 'No autenticado' })
    @ApiResponse({ status: 403, description: 'Requiere rol de Profesor' })
    async getDashboard(@Req() req: any): Promise<TeacherDashboardResponseDto> {
        const teacherId = req.user.userId;
        return await this.teacherService.getDashboard(teacherId);
    }

    // Spec 0001 (docs/specs/0001-modulo-profesor.md). Un id que no es UUID responde 404 igual que uno ajeno (TACC-01/02)
    @Get('assignments/:assignmentId/summary')
    @ApiOperation({
        summary: 'Indicadores de un grupo y materia asignados (solo datos escolares)',
        description:
            'Matriculados, con licencia vigente, activos en los últimos 7 días y dominio de la materia por estudiante. Sin documentos.',
    })
    @ApiResponse({ status: 200, description: 'Indicadores de la asignación' })
    @ApiResponse({ status: 404, description: 'La asignación no es del profesor o no está activa' })
    async getAssignmentSummary(
        @Req() req: any,
        @Param('assignmentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) assignmentId: string,
    ) {
        return await this.teacherService.getAssignmentSummary(req.user.userId, assignmentId);
    }

    @Get('assignments/:assignmentId/students/:studentId')
    @ApiOperation({
        summary: 'Seguimiento escolar de un estudiante del grupo',
        description:
            'Datos personales y progreso escolar en cada materia que el profesor tiene en el grupo. La consulta queda registrada.',
    })
    @ApiResponse({ status: 200, description: 'Seguimiento del estudiante' })
    @ApiResponse({ status: 404, description: 'La asignación no es del profesor o el estudiante no está en el grupo' })
    async getStudentDetail(
        @Req() req: any,
        @Param('assignmentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) assignmentId: string,
        @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND })) studentId: string,
    ) {
        return await this.teacherService.getStudentDetail(req.user.userId, assignmentId, studentId);
    }
}