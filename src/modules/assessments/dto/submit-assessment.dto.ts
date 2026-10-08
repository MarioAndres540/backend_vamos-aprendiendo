import {
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
  IsString,
  IsOptional,
  IsUUID,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AssessmentTarget {
  NINO = 'nino',
  ADULTO = 'adulto',
}

export class AssessmentAnswerItemDto {
  @ApiProperty({ example: 1, description: 'Número identificador de la pregunta (1 al 10)' })
  @IsNumber()
  @Min(1)
  @Max(10)
  questionId: number;

  @ApiProperty({ example: 'lectoescritura', description: 'Dimensión o categoría de la pregunta' })
  @IsString()
  dimension: string;

  @ApiProperty({ example: 4, description: 'Puntaje asignado (1 a 5 en escala Likert)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  score: number;
}

export class SubmitAssessmentDto {
  @ApiProperty({ enum: AssessmentTarget, example: AssessmentTarget.NINO, description: 'Tipo de formulario (niño o adulto)' })
  @IsEnum(AssessmentTarget, { message: 'El tipo debe ser nino o adulto' })
  targetType: AssessmentTarget;

  @ApiPropertyOptional({ description: 'ID del estudiante evaluado (si aplica)' })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante evaluado no es válido' })
  studentId?: string;

  @ApiProperty({
    type: [AssessmentAnswerItemDto],
    description: 'Arreglo de respuestas del formulario (máximo 10 preguntas)',
  })
  @IsArray()
  @ArrayMinSize(5, { message: 'El formulario debe contener al menos 5 respuestas' })
  @ArrayMaxSize(10, { message: 'El formulario no puede exceder las 10 preguntas' })
  @ValidateNested({ each: true })
  @Type(() => AssessmentAnswerItemDto)
  answers: AssessmentAnswerItemDto[];

  @ApiPropertyOptional({ description: 'Observaciones cualitativas adicionales del evaluador' })
  @IsOptional()
  @IsString()
  observations?: string;
}
