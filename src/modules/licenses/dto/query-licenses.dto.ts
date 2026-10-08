import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LicensePlan, LicenseOrigin } from './create-license.dto';

export class QueryLicensesDto {
  @ApiPropertyOptional({ enum: LicensePlan })
  @IsOptional()
  @IsEnum(LicensePlan)
  planType?: LicensePlan;

  @ApiPropertyOptional({ enum: LicenseOrigin })
  @IsOptional()
  @IsEnum(LicenseOrigin)
  origin?: LicenseOrigin;

  @ApiPropertyOptional({ description: 'ID del estudiante' })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;
}
