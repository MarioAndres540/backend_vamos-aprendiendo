import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const CLIENT_END_REASONS = ['app_closed', 'logout'] as const;
export type ClientEndReason = (typeof CLIENT_END_REASONS)[number];

export class EndAppSessionDto {
  @ApiPropertyOptional({ enum: CLIENT_END_REASONS, default: 'app_closed', description: 'Motivo del cierre' })
  @IsOptional()
  @IsIn(CLIENT_END_REASONS, { message: 'El motivo debe ser app_closed o logout' })
  reason?: ClientEndReason;
}
