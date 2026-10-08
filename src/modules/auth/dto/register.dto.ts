import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsBoolean,
  Equals,
  Matches,
  IsOptional,
  IsArray,
  ValidateNested,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DocumentType {
  CC = 'CC',
  TI = 'TI',
  RC = 'RC',
  CE = 'CE',
  PASAPORTE = 'PASAPORTE',
}

export enum PublicRegistrationRole {
  USER = 'usuario',
  TEST = 'test',
  TEACHER = 'profesor',
}

export class CreateChildItemDto {
  @ApiProperty({ example: 'Mateo', description: 'Nombre del estudiante/hijo' })
  @IsString()
  @MinLength(2)
  firstName: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del estudiante/hijo' })
  @IsString()
  @MinLength(2)
  lastName: string;

  @ApiProperty({ enum: DocumentType, example: DocumentType.TI, description: 'Tipo de documento' })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty({ example: '1098765432', description: 'Número de documento de identidad' })
  @IsString()
  @MinLength(4)
  documentNumber: string;

  @ApiProperty({ example: '2016-05-15', description: 'Fecha de nacimiento' })
  @IsDateString({}, { message: 'La fecha de nacimiento debe tener formato YYYY-MM-DD' })
  birthDate: string;

  @ApiProperty({ example: 8, description: 'Edad del niño (calculada o ingresada)' })
  @IsInt()
  @Min(3)
  @Max(17)
  age: number;

  @ApiPropertyOptional({ description: 'ID de la institución o colegio (si ya está matriculado)' })
  @IsOptional()
  // 'loose': PostgreSQL acepta cualquier UUID con formato válido (los colegios semilla no son v4)
  @IsUUID('loose', { message: 'El colegio seleccionado para el estudiante no es válido' })
  institutionId?: string;

  @ApiPropertyOptional({ example: '3° Primaria', description: 'Grado escolar' })
  @IsOptional()
  @IsString()
  grade?: string;
}

export class RegisterDto {
  @ApiPropertyOptional({
    enum: PublicRegistrationRole,
    default: PublicRegistrationRole.TEST,
    description: 'Rol en el registro: usuario (tutor/adulto), profesor o test.',
  })
  @IsOptional()
  @IsEnum(PublicRegistrationRole, { message: 'El rol debe ser usuario, test o profesor' })
  role?: PublicRegistrationRole;

  @ApiProperty({ example: 'Juan', description: 'Nombre del usuario' })
  @IsString()
  @MinLength(2)
  firstName: string;

  @ApiProperty({ example: 'Pérez', description: 'Apellido del usuario' })
  @IsString()
  @MinLength(2)
  lastName: string;

  @ApiProperty({ enum: DocumentType, example: DocumentType.CC, description: 'Tipo de documento de identificación' })
  @IsEnum(DocumentType, { message: 'El tipo de documento debe ser CC, TI, RC, CE o PASAPORTE' })
  documentType: DocumentType;

  @ApiProperty({ example: '1234567890', description: 'Número de documento de identidad' })
  @IsString()
  @MinLength(5)
  documentNumber: string;

  @ApiPropertyOptional({ example: '1995-08-20', description: 'Fecha de nacimiento' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({ example: 28, description: 'Edad del usuario (mínimo 18 años para tutores/docentes)' })
  @IsInt()
  @Min(6, { message: 'La edad mínima requerida es 6 años' })
  @Max(120)
  age: number;

  @ApiProperty({ example: 'juan.perez@example.com', description: 'Correo electrónico' })
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  email: string;

  @ApiProperty({ example: '+573001234567', description: 'Número de teléfono de contacto' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Número de teléfono inválido' })
  phone: string;

  @ApiProperty({ example: true, description: 'Aceptación de términos y condiciones' })
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
  acceptedTerms: boolean;

  @ApiProperty({ example: 'Password123!', description: 'Contraseña segura (mínimo 6 caracteres)' })
  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;

  // Campos condicionales para DOCENTE
  @ApiPropertyOptional({ description: 'ID de la institución donde enseña (Requerido si role = profesor)' })
  @IsOptional()
  @IsUUID('loose', { message: 'La institución seleccionada no es válida' })
  institutionId?: string;

  @ApiPropertyOptional({ description: 'Tarjeta profesional o matrícula docente' })
  @IsOptional()
  @IsString()
  professionalLicense?: string;

  // Campos condicionales para TUTOR (agregar múltiples hijos)
  @ApiPropertyOptional({
    type: [CreateChildItemDto],
    description: 'Listado de hijos a cargo (si se registra como tutor)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChildItemDto)
  children?: CreateChildItemDto[];
}