import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
    @IsEmail({}, { message: 'Ingresa un correo electroníco válido' })
    email: string;

    @IsString()
    @MinLength(6, { message: 'La contraseña debe tener almenos 6 caracteres' })
    password: string;
}