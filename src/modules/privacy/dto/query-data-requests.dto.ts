import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { DataRequestStatus } from '../privacy.constants';

export class QueryDataRequestsDto {
  @ApiPropertyOptional({ enum: DataRequestStatus })
  @IsOptional()
  @IsEnum(DataRequestStatus, { message: 'Estado no válido' })
  status?: DataRequestStatus;
}
