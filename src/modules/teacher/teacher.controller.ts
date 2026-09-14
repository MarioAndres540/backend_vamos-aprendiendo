import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}