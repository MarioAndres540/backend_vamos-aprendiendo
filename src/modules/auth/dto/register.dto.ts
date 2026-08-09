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
} from 'class-validator';

export enum DocumentType {
    CC = 'CC',
    TI = 'TI',
    CE = 'CE',
    PASAPORTE = 'PASAPORTE',
}

export class RegisterDto {
    @IsString()
    @MinLength(2)
    firstName: string;

    @IsString()
    @MinLength(2)
    lastName: string;

    @IsEnum(DocumentType, { message: 'El tipo de documento debe ser CC, TI, CE o PASAPORTE' })
    documentType: DocumentType;

    @IsString()
    @MinLength(5)
    documentNumber: string;

    @IsInt()
    @Min(6, { message: 'El usuario tutor debe tener al menos 18 años' })
    @Max(120)
    age: number;

    @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
    email: string;

    @IsString()
    @Matches(/^\+?[0-9]{7,15}$/, { message: 'Número de teléfono inválido' })
    phone: string;

    @IsBoolean()
    @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
    acceptedTerms: boolean;

    @IsString()
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    password: string;
}