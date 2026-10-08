import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PreauthCheckDto {
  @ApiProperty({ description: 'ID de la institución educativa', example: '11111111-1111-1111-1111-111111111111' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la institución es requerido' })
  institutionId: string;

  @ApiProperty({ description: 'Número de documento de identidad del docente', example: '1020304050' })
  @IsString()
  @IsNotEmpty({ message: 'El número de documento es requerido' })
  documentNumber: string;

  @ApiProperty({ description: 'Correo electrónico institucional del docente', example: 'carlos.mendoza@republicacolombia.edu.co' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo institucional es requerido' })
  email: string;
}
