import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

export class AdminExtendTrialDto {
  @ApiProperty({
    example: 14,
    description: 'Días adicionales de prueba a partir de hoy o fecha actual',
  })
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}
