import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { DocumentType } from '../../auth/dto/register.dto';

// Datos que la persona puede cambiar desde Configuración (nombres y documento los cambia el administrador)
export class UpdateMyProfileDto {
  @ApiPropertyOptional({
    example: '+573001234567',
    description: 'Teléfono de contacto',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Número de teléfono inválido' })
  phone?: string;

  @ApiPropertyOptional({
    enum: DocumentType,
    example: DocumentType.CC,
    description: 'Tipo de documento',
  })
  @IsOptional()
  @IsEnum(DocumentType, {
    message: 'El tipo de documento debe ser CC, TI, RC, CE o PASAPORTE',
  })
  documentType?: DocumentType;
}
