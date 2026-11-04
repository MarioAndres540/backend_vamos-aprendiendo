import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';
import { CreateChildItemDto } from '../../auth/dto/register.dto';

/** Agregar un menor desde la cuenta: exige la autorización del representante legal (Ley 1581, spec 0004 PD-CONS-03) */
export class CreateChildDto extends CreateChildItemDto {
  @ApiProperty({
    example: true,
    description:
      'Autorización, como representante legal, del tratamiento de los datos del menor',
  })
  @IsBoolean()
  @Equals(true, {
    message:
      'Debes autorizar, como representante legal, el tratamiento de los datos del menor',
  })
  acceptedMinorsData: boolean;
}
