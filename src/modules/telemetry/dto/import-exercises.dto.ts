import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  EXERCISE_ID_MESSAGE,
  EXERCISE_ID_PATTERN,
} from './record-exercise.dto';

export const MAX_IMPORT_EXERCISES = 100;

/**
 * Ejercicios que el dispositivo ya tenía completados antes de enviarse al backend (Unity guardaba "completado"
 * solo en PlayerPrefs). Se registran una vez como importados, sin cobertura ni exactitud inventadas.
 */
export class ImportExercisesDto {
  @ApiPropertyOptional({
    description:
      'Hijo al que pertenecen. Obligatorio si la cuenta es de un tutor con hijos; debe estar vinculado a la cuenta.',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiProperty({
    example: ['escritura.lo_a', 'matematicas.d_7'],
    description: `Ids de ejercicios completados en el dispositivo (hasta ${MAX_IMPORT_EXERCISES} por petición)`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Indica al menos un ejercicio' })
  @ArrayMaxSize(MAX_IMPORT_EXERCISES, {
    message: `Máximo ${MAX_IMPORT_EXERCISES} ejercicios por petición`,
  })
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(EXERCISE_ID_PATTERN, { each: true, message: EXERCISE_ID_MESSAGE })
  exerciseIds: string[];
}
