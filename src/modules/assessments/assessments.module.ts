import { Module } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { AssessmentsController } from './assessments.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  imports: [SupabaseModule, PrivacyModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
