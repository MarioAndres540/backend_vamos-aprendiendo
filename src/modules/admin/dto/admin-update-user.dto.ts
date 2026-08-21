import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsBoolean,
  Matches,
  IsISO8601,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum';
import { DocumentType } from '../../auth/dto/register.dto';

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ example: 'Juan', description: 'Nombre del usuario' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Pérez', description: 'Apellido del usuario' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: DocumentType, example: DocumentType.CC, description: 'Tipo de documento' })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiPropertyOptional({ example: '1234567890', description: 'Número de documento de identidad' })
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @ApiPropertyOptional({ example: 30, description: 'Edad del usuario' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ example: '+573001234567', description: 'Teléfono de contacto' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Número de teléfono inválido' })
  phone?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.USER, description: 'Rol asignado por el administrador' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ example: true, description: 'Estado activo o inactivo de la cuenta' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description: 'Fecha límite de periodo de prueba (para cuentas test)',
  })
  @IsOptional()
  @IsISO8601()
  trialEndsAt?: string | null;
}
