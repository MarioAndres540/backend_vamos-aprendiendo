import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class UpdateMyEmailDto {
  @ApiProperty({
    example: 'nuevo.correo@example.com',
    description: 'Correo nuevo',
  })
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  email: string;

  // Se pide la contraseña para que nadie con la sesión abierta pueda cambiar el correo de la cuenta
  @ApiProperty({ description: 'Contraseña actual, para confirmar el cambio' })
  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña actual' })
  currentPassword: string;
}
