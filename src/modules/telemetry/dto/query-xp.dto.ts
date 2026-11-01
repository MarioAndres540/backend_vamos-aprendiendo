import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryXpDto {
  @ApiPropertyOptional({
    description:
      'Hijo del tutor. Sin él, los datos son del propio usuario (adulto o tester).',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiPropertyOptional({
    example: 20,
    description:
      'Cuántas recompensas recientes devolver (1 a 100). Por defecto 20.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1)
  @Max(100)
  limit?: number;
}
