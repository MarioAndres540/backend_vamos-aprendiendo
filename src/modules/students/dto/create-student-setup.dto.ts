import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  IsIn,
} from 'class-validator';

export class CreateStudentSetupDto {
  @ApiProperty({
    description: 'Modo del diagnostico',
    enum: ['kids', 'adults'],
    example: 'kids',
  })
  @IsString()
  @IsIn(['kids', 'adults'], { message: 'El modo debe ser kids o adults' })
  mode: 'kids' | 'adults';

  // Kids fields
  @ApiPropertyOptional({ description: 'Super poder del nino', example: 'letras' })
  @IsOptional()
  @IsString()
  superPower?: string;

  @ApiPropertyOptional({ description: 'Reino elegido', example: 'palabras' })
  @IsOptional()
  @IsString()
  chosenRealm?: string;

  @ApiPropertyOptional({ description: 'Nivel de autoeficacia (1-3)', minimum: 1, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  selfEfficacy?: number;

  @ApiPropertyOptional({ description: 'Estilos de juego', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  playStyles?: string[];

  // Adults fields
  @ApiPropertyOptional({ description: 'Meta cognitiva del adulto', example: 'memoria' })
  @IsOptional()
  @IsString()
  cognitiveGoal?: string;

  @ApiPropertyOptional({ description: 'Estilo de aprendizaje', example: 'visual' })
  @IsOptional()
  @IsString()
  learningStyle?: string;

  @ApiPropertyOptional({ description: 'Areas de interes', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicInterests?: string[];
}
