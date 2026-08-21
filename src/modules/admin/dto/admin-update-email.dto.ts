import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class AdminUpdateEmailDto {
  @ApiProperty({
    example: 'nuevo.correo@ejemplo.com',
    description: 'Nuevo correo electrónico para el usuario',
  })
  @IsEmail({}, { message: 'Debe ser un correo electrónico válido' })
  @IsNotEmpty()
  email: string;
}
