import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum InstitutionType {
  PUBLICO = 'publico',
  PRIVADO = 'privado',
}

export class QueryInstitutionsDto {
  @ApiPropertyOptional({ description: 'Filtro por tipo de institución', enum: InstitutionType })
  @IsOptional()
  @IsEnum(InstitutionType, { message: 'El tipo debe ser publico o privado' })
  type?: InstitutionType;

  @ApiPropertyOptional({ description: 'Búsqueda por nombre o ciudad' })
  @IsOptional()
  @IsString()
  search?: string;
}
