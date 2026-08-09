import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class OAuthLoginDto {
  @IsString()
  @IsNotEmpty()
  provider: 'google' | 'github' | 'facebook' | 'apple';

  @IsString()
  @IsOptional()
  idToken?: string;

  @IsString()
  @IsOptional()
  accessToken?: string;
}