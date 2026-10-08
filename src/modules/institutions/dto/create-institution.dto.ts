import { IsString, IsNotEmpty, IsEnum, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InstitutionType } from './query-institutions.dto';

export class CreateInstitutionDto {
  @ApiProperty({ description: 'NIT o código institucional único', example: '900123456-7' })
  @IsString()
  @IsNotEmpty({ message: 'El NIT es requerido' })
  nit: string;

  @ApiProperty({ description: 'Nombre oficial de la institución', example: 'Colegio Distrital República de Colombia' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  name: string;

  @ApiProperty({ description: 'Tipo de institución', enum: InstitutionType, example: InstitutionType.PUBLICO })
  @IsEnum(InstitutionType, { message: 'El tipo debe ser publico o privado' })
  type: InstitutionType;

  @ApiProperty({ description: 'Dirección física de la sede principal', example: 'Calle 68 # 24-50' })
  @IsString()
  @IsNotEmpty({ message: 'La dirección es requerida' })
  address: string;

  @ApiProperty({ description: 'Ciudad donde se ubica la institución', example: 'Bogotá D.C.' })
  @IsString()
  @IsNotEmpty({ message: 'La ciudad es requerida' })
  city: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto', example: '6013456789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Correo electrónico de secretaría o rectoría', example: 'rectoria@republicacolombia.edu.co' })
  @IsOptional()
  @IsEmail({}, { message: 'El formato de correo no es válido' })
  email?: string;
}
