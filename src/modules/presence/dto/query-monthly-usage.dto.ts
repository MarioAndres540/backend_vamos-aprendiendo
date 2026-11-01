import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class QueryMonthlyUsageDto {
  @ApiPropertyOptional({
    description:
      'Hijo del tutor: solo cuenta las sesiones que la app abrió con ese hijo. Sin él, todas las de la cuenta.',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;
}
