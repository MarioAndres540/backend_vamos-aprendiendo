import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { PrivacyService } from './privacy.service';
import { QueryDataRequestsDto } from './dto/query-data-requests.dto';
import { UpdateDataRequestDto } from './dto/update-data-request.dto';

// Trámite de las solicitudes de los titulares por el super administrador (spec 0004, PD-ADM)
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/data-requests')
export class AdminDataRequestsController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get()
  @ApiOperation({
    summary: 'Solicitudes de los titulares, con las vencidas marcadas',
  })
  list(@Query() query: QueryDataRequestsDto) {
    return this.privacyService.listRequests(query.status);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Tramitar, resolver o rechazar una solicitud' })
  @ApiResponse({ status: 400, description: 'Falta la respuesta al titular' })
  update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDataRequestDto,
  ) {
    return this.privacyService.updateRequest(user.userId, id, dto);
  }

  @Post(':id/execute-suppression')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ejecutar la supresión de una solicitud de supresión o revocatoria',
  })
  @ApiResponse({
    status: 409,
    description: 'Cuenta escolar o administrativa, o solicitud cerrada',
  })
  executeSuppression(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.privacyService.executeSuppression(user.userId, id);
  }
}
