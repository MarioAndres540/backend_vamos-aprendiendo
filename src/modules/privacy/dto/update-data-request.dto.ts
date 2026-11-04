import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataRequestStatus } from '../privacy.constants';

export class UpdateDataRequestDto {
  @ApiProperty({
    enum: DataRequestStatus,
    example: DataRequestStatus.IN_PROGRESS,
  })
  @IsEnum(DataRequestStatus, { message: 'Estado no válido' })
  status: DataRequestStatus;

  @ApiPropertyOptional({
    description: 'Respuesta al titular (obligatoria al resolver o rechazar)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  response?: string;
}
