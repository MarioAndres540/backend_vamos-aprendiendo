import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const APP_SESSION_CLIENTS = ['unity', 'web'] as const;
export type AppSessionClient = (typeof APP_SESSION_CLIENTS)[number];

export class StartAppSessionDto {
  @ApiPropertyOptional({ enum: APP_SESSION_CLIENTS, default: 'unity', description: 'Cliente que abre la sesión' })
  @IsOptional()
  @IsIn(APP_SESSION_CLIENTS, { message: 'El cliente debe ser unity o web' })
  client?: AppSessionClient;

  @ApiPropertyOptional({ description: 'Hijo que está usando la app (debe estar vinculado al tutor)' })
  @IsOptional()
  @IsUUID('loose', { message: 'El estudiante no es válido' })
  studentId?: string;

  @ApiPropertyOptional({ example: 'Android 14 · Samsung SM-A546', description: 'Descripción del dispositivo' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;

  @ApiPropertyOptional({ example: '1.0.3', description: 'Versión de la app' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
