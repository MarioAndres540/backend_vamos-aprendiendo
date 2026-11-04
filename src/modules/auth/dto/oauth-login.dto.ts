import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class OAuthLoginDto {
  @ApiProperty({
    enum: ['google', 'github', 'facebook', 'apple'],
    example: 'google',
    description: 'Proveedor OAuth',
  })
  @IsString()
  @IsNotEmpty()
  provider: 'google' | 'github' | 'facebook' | 'apple';

  @ApiPropertyOptional({
    description: 'ID Token obtenido del proveedor OAuth',
  })
  @IsString()
  @IsOptional()
  idToken?: string;

  @ApiPropertyOptional({
    description: 'Access Token obtenido del proveedor OAuth',
  })
  @IsString()
  @IsOptional()
  accessToken?: string;

  // Ley 1581 (spec 0004, PD-CONS-04): obligatorias solo cuando el ingreso crea una cuenta nueva
  @ApiPropertyOptional({ description: 'Autorización del tratamiento de datos (cuenta nueva)' })
  @IsBoolean()
  @IsOptional()
  acceptedTerms?: boolean;

  @ApiPropertyOptional({ description: 'Versión de la política aceptada (cuenta nueva)' })
  @IsString()
  @IsOptional()
  policyVersion?: string;
}
