import { IsEnum, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LicensePlan {
  FREE = 'free',
  TRIAL = 'trial',
  PRO = 'pro',
}

export enum LicenseOrigin {
  PERSONAL = 'personal',
  INSTITUCIONAL = 'institucional',
}

export class CreateLicenseDto {
  @ApiProperty({ enum: LicensePlan, example: LicensePlan.PRO, description: 'Tipo de plan de la licencia' })
  @IsEnum(LicensePlan, { message: 'El plan debe ser free, trial o pro' })
  planType: LicensePlan;

  @ApiProperty({ enum: LicenseOrigin, example: LicenseOrigin.PERSONAL, description: 'Origen de la suscripción' })
  @IsEnum(LicenseOrigin, { message: 'El origen debe ser personal o institucional' })
  origin: LicenseOrigin;

  @ApiPropertyOptional({ description: 'ID del perfil propietario (Tutor / Adulto)' })
  @IsOptional()
  @IsUUID('loose', { message: 'El perfil propietario no es válido' })
  ownerProfileId?: string;

  @ApiPropertyOptional({ description: 'ID de la institución que otorga la licencia' })
  @IsOptional()
  @IsUUID('loose', { message: 'La institución no es válida' })
  institutionId?: string;

  @ApiPropertyOptional({ description: 'ID del estudiante beneficiario' })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiPropertyOptional({ description: 'Fecha de inicio de vigencia' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Fecha de expiración de la licencia' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
