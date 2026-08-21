import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
    @ApiProperty({ example: 'usuario@ejemplo.com', description: 'Correo electrónico registrado' })
    @IsEmail({}, { message: 'Ingresa un correo electroníco válido' })
    email: string;

    @ApiProperty({ example: 'Password123!', description: 'Contraseña del usuario' })
    @IsString()
    @MinLength(6, { message: 'La contraseña debe tener almenos 6 caracteres' })
    password: string;
}