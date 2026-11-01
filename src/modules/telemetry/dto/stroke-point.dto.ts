import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// Topes por intento: el cuerpo JSON de Express admite ~100 KB, así que Unity debe submuestrear los puntos
export const MAX_POINTS_PER_STROKE = 400;
export const MAX_STROKES = 12;

/** Un punto del trazo en el cuadrado normalizado de la letra (0..1), igual que TraceValidator en Unity */
export class StrokePointDto {
  @ApiProperty({ example: 0.42, description: 'Posición horizontal 0..1' })
  @IsNumber({}, { message: 'x debe ser un número' })
  @Min(-0.5)
  @Max(1.5)
  x: number;

  @ApiProperty({ example: 0.1, description: 'Posición vertical 0..1' })
  @IsNumber({}, { message: 'y debe ser un número' })
  @Min(-0.5)
  @Max(1.5)
  y: number;

  @ApiPropertyOptional({
    example: 0.35,
    description: 'Segundos desde que empezó el intento',
  })
  @IsOptional()
  @IsNumber({}, { message: 't debe ser un número' })
  @Min(0)
  @Max(3600)
  t?: number;
}

/** Un trazo (desde que se apoya el dedo hasta que se levanta): lista ordenada de puntos */
export class StrokeDto {
  @ApiProperty({ type: [StrokePointDto] })
  @IsArray()
  @ArrayMaxSize(MAX_POINTS_PER_STROKE, {
    message: `Cada trazo admite hasta ${MAX_POINTS_PER_STROKE} puntos`,
  })
  @ValidateNested({ each: true })
  @Type(() => StrokePointDto)
  points: StrokePointDto[];
}
