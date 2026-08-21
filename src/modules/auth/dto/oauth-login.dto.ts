import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
}