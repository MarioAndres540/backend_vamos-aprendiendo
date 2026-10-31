import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryAppHistoryDto {
  @ApiPropertyOptional({
    example: 30,
    description: 'Días hacia atrás, contando hoy (1 a 365). Por defecto 30.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Los días deben ser un número entero' })
  @Min(1, { message: 'El periodo mínimo es 1 día' })
  @Max(365, { message: 'El periodo máximo es 365 días' })
  days?: number;
}
