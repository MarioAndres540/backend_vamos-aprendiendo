import { ApiProperty } from '@nestjs/swagger';
import { ImportExercisesDto } from './import-exercises.dto';

/**
 * Ejercicios cuyo XP el jugador acaba de cobrar al abrir el cofre. Mismo formato que la importación: hijo opcional
 * (obligatorio si la cuenta es de un tutor con hijos) y los ids de ejercicio.
 */
export class ClaimXpDto extends ImportExercisesDto {
  @ApiProperty({
    example: ['escritura.lo_a', 'matematicas.d_7'],
    description:
      'Ids de ejercicios cuyo XP se cobra en el cofre (hasta 100 por petición). Los que no están aprobados o ya estaban cobrados se omiten.',
  })
  declare exerciseIds: string[];
}
