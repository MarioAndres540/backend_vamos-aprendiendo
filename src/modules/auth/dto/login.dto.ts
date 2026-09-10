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

/*


# Servicios de nest
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://ydxyjakzeaohxpupcpzv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_publishable_sz4GtZQILskuhr7Lnvc78Q_SYyo0jK9

# Autenticacion JWT
JWT_SECRET=5e5a356522bb00563f87a5d618b5709292237193c6c800e40f7363d69960ac0e
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=7f8b9a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a
JWT_REFRESH_EXPIRES_IN=7d
*/