import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DataRequestType } from '../privacy.constants';

export class CreateDataRequestDto {
  @ApiProperty({ enum: DataRequestType, example: DataRequestType.QUERY })
  @IsEnum(DataRequestType, { message: 'Tipo de solicitud no válido' })
  type: DataRequestType;

  @ApiPropertyOptional({
    description: 'Menor a cargo al que se refiere la solicitud',
  })
  @IsOptional()
  @IsUUID('loose', { message: 'El menor seleccionado no es válido' })
  studentId?: string;

  @ApiProperty({
    example: 'Quiero saber qué datos de mi hijo tiene la plataforma.',
  })
  @IsString()
  @MinLength(10, { message: 'Describe tu solicitud en al menos 10 caracteres' })
  @MaxLength(2000, {
    message: 'La descripción no puede superar 2000 caracteres',
  })
  description: string;
}
