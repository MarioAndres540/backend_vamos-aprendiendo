import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { AdminDataRequestsController } from './admin-data-requests.controller';
import { PrivacyService } from './privacy.service';

@Module({
  controllers: [PrivacyController, AdminDataRequestsController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
