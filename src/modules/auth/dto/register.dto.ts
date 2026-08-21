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
} from 'class-validator';

export enum DocumentType {
    CC = 'CC',
    TI = 'TI',
    CE = 'CE',
    PASAPORTE = 'PASAPORTE',
}

export enum PublicRegistrationRole {
    USER = 'usuario',
    TEST = 'test',
}

export class RegisterDto {
    @ApiPropertyOptional({
        enum: PublicRegistrationRole,
        default: PublicRegistrationRole.TEST,
        description: 'Rol del usuario en el registro (usuario o test). Por defecto es test.',
    })
    @IsOptional()
    @IsEnum(PublicRegistrationRole, { message: 'El rol inicial solo puede ser usuario o test' })
    role?: PublicRegistrationRole;
    @ApiProperty({ example: 'Juan', description: 'Nombre del tutor o usuario' })
    @IsString()
    @MinLength(2)
    firstName: string;

    @ApiProperty({ example: 'Pérez', description: 'Apellido del tutor o usuario' })
    @IsString()
    @MinLength(2)
    lastName: string;

    @ApiProperty({ enum: DocumentType, example: DocumentType.CC, description: 'Tipo de documento de identificación' })
    @IsEnum(DocumentType, { message: 'El tipo de documento debe ser CC, TI, CE o PASAPORTE' })
    documentType: DocumentType;

    @ApiProperty({ example: '1234567890', description: 'Número de documento de identidad' })
    @IsString()
    @MinLength(5)
    documentNumber: string;

    @ApiProperty({ example: 25, description: 'Edad del usuario tutor (mínimo 18 años)' })
    @IsInt()
    @Min(6, { message: 'El usuario tutor debe tener al menos 18 años' })
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
}