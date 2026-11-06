import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Avance del jugador de nivel. El backend decide si procede: el portal y el nivel 2 solo se abren cuando el estudiante cobró
 * la experiencia de todas las actividades del nivel 1, y el nivel nunca baja.
 */
export class UpdateLevelDto {
  @ApiPropertyOptional({
    description:
      'Hijo del tutor. Obligatorio si la cuenta es de un tutor con hijos; debe estar vinculado a la cuenta.',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiPropertyOptional({ example: 2, description: 'Nivel al que llegó (1 o 2).' })
  @IsOptional()
  @IsInt({ message: 'El nivel debe ser un número entero' })
  @Min(1)
  @Max(2)
  level?: number;

  @ApiPropertyOptional({ example: true, description: 'El jugador cruzó el portal del nivel 1.' })
  @IsOptional()
  @IsBoolean()
  portalPassed?: boolean;
}
