import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum } from 'class-validator';
import { ConsentType } from '../privacy.constants';

export class UpdateConsentDto {
  @ApiProperty({
    enum: ConsentType,
    example: ConsentType.SENSITIVE_DATA,
    description:
      'Solo datos_sensibles se puede cambiar desde la cuenta (PD-SENS-03)',
  })
  @IsEnum(ConsentType, { message: 'Tipo de autorización no válido' })
  type: ConsentType;

  @ApiProperty({
    example: true,
    description: 'true otorga la autorización; false la revoca',
  })
  @IsBoolean()
  granted: boolean;
}
