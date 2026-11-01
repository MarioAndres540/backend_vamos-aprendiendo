import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_STROKES, StrokeDto } from './stroke-point.dto';

// Valores del enum trazo_direccion_enum (migración 20261001)
export const STROKE_DIRECTIONS = [
  'arriba_abajo',
  'abajo_arriba',
  'izq_der',
  'der_izq',
  'mixto_atipico',
] as const;
export type StrokeDirection = (typeof STROKE_DIRECTIONS)[number];

// '<ruta>.<glyphId de Unity>': escritura.lo_a, escritura.up_E, matematicas.d_7
export const EXERCISE_ID_PATTERN = /^[a-z]+\.(d|lo|up)_\S{1,4}$/u;
export const EXERCISE_ID_MESSAGE =
  'El ejercicio no tiene un formato válido (ej. escritura.lo_a)';

export class StrokeDeviationsDto {
  @ApiPropertyOptional({
    example: 'Empezó fuera del punto 1',
    description: 'Aviso para el tutor',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alerta?: string;

  @ApiPropertyOptional({ description: 'El trazo sigue un patrón atípico' })
  @IsOptional()
  @IsBoolean()
  patronAtipico?: boolean;
}

/**
 * Un intento de ejercicio (una letra o un número) que reporta Unity. El backend decide si quedó aprobado a partir de
 * coverage y accuracy (reward_rules): el cliente no envía "passed".
 * Contrato completo y datos pendientes de Unity: backend/docs/unity-exercises.md
 */
export class RecordExerciseDto {
  @ApiProperty({
    example: 'escritura.lo_a',
    description:
      "Id del ejercicio en exercise_catalog: '<ruta>.<glyphId de Unity>'",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(EXERCISE_ID_PATTERN, { message: EXERCISE_ID_MESSAGE })
  exerciseId: string;

  @ApiProperty({
    description:
      'Id único del intento, generado por Unity. Si la petición se repite (reintento, doble envío) no se duplica nada.',
  })
  @IsUUID('loose', { message: 'clientAttemptId debe ser un UUID' })
  clientAttemptId: string;

  @ApiPropertyOptional({
    description:
      'Hijo que juega. Obligatorio si la cuenta es de un tutor con hijos; debe estar vinculado a la cuenta.',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiProperty({
    example: 0.91,
    description: 'Cobertura 0..1: parte de la plantilla que quedó cubierta',
  })
  @IsNumber({}, { message: 'coverage debe ser un número' })
  @Min(0)
  @Max(1)
  coverage: number;

  @ApiProperty({
    example: 0.99,
    description: 'Exactitud 0..1: parte del trazo que cayó sobre la plantilla',
  })
  @IsNumber({}, { message: 'accuracy debe ser un número' })
  @Min(0)
  @Max(1)
  accuracy: number;

  // ---- Métricas geométricas: opcionales hasta que Unity las instrumente. No se inventan valores. ----

  @ApiPropertyOptional({
    example: 8.4,
    description: 'Duración del intento (s)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(3600)
  durationSeconds?: number;

  @ApiPropertyOptional({
    example: 88.5,
    description:
      'Precisión 0..100 del trazo (forma + orden + dirección). La fórmula la define la etapa de instrumentación de Unity; sin ella el dashboard muestra "no disponible".',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  precisionPct?: number;

  @ApiPropertyOptional({ description: '¿Empezó en el punto 1?' })
  @IsOptional()
  @IsBoolean()
  startPointOk?: boolean;

  @ApiPropertyOptional({ description: '¿Respetó el orden de los trazos?' })
  @IsOptional()
  @IsBoolean()
  orderOk?: boolean;

  @ApiPropertyOptional({ enum: STROKE_DIRECTIONS })
  @IsOptional()
  @IsIn(STROKE_DIRECTIONS, { message: 'La dirección no es válida' })
  direction?: StrokeDirection;

  @ApiPropertyOptional({ example: 0, description: 'Giro detectado en grados' })
  @IsOptional()
  @IsNumber()
  @Min(-360)
  @Max(360)
  rotationDegrees?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Veces que el dedo se salió de la línea',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  offPathCount?: number;

  @ApiPropertyOptional({
    type: [StrokeDto],
    description: 'Trayectoria esperada',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STROKES)
  @ValidateNested({ each: true })
  @Type(() => StrokeDto)
  expectedPath?: StrokeDto[];

  @ApiPropertyOptional({
    type: [StrokeDto],
    description: 'Puntos recorridos por el estudiante, en orden',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STROKES)
  @ValidateNested({ each: true })
  @Type(() => StrokeDto)
  userStrokes?: StrokeDto[];

  @ApiPropertyOptional({ type: StrokeDeviationsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StrokeDeviationsDto)
  deviations?: StrokeDeviationsDto;
}
