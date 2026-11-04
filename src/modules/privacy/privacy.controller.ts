import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrivacyService } from './privacy.service';
import { UpdateConsentDto } from './dto/update-consent.dto';
import { CreateDataRequestDto } from './dto/create-data-request.dto';
import { ConsentMetaParam } from './consent-meta.decorator';
import type { ConsentMeta } from './privacy.constants';

// Derechos del titular (Ley 1581 de 2012, spec 0004)
@ApiTags('Privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get('policy')
  @ApiOperation({
    summary: 'Versión vigente de la política de tratamiento de datos (pública)',
  })
  getPolicy() {
    return this.privacyService.getPolicy();
  }

  @Get('me/consents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado vigente de mis autorizaciones' })
  getMyConsents(@CurrentUser() user: { userId: string }) {
    return this.privacyService.getCurrentConsents(user.userId);
  }

  @Post('me/consents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Otorgar o revocar la autorización de datos sensibles',
  })
  @ApiResponse({
    status: 400,
    description: 'La autorización es obligatoria: se revoca con una solicitud',
  })
  updateMyConsent(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateConsentDto,
    @ConsentMetaParam() meta: ConsentMeta,
  ) {
    return this.privacyService.updateConsent(user.userId, dto, meta);
  }

  @Get('me/export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Descargar mis datos y los de mi ecosistema (derecho de acceso)',
  })
  exportMyData(@CurrentUser() user: { userId: string }) {
    return this.privacyService.exportMyData(user.userId);
  }

  @Get('me/requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mis solicitudes (consultas y reclamos)' })
  listMyRequests(@CurrentUser() user: { userId: string }) {
    return this.privacyService.listMyRequests(user.userId);
  }

  @Post('me/requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Radicar una consulta o un reclamo' })
  @ApiResponse({
    status: 201,
    description: 'Solicitud radicada con su plazo legal',
  })
  @ApiResponse({
    status: 404,
    description: 'El menor no está vinculado a la cuenta',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya hay una solicitud igual en trámite',
  })
  createRequest(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateDataRequestDto,
  ) {
    return this.privacyService.createRequest(user.userId, dto);
  }
}
