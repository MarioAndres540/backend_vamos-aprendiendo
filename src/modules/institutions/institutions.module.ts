import { Module } from '@nestjs/common';
import { InstitutionsService } from './institutions.service';
import { InstitutionsController } from './institutions.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [InstitutionsController],
  providers: [InstitutionsService],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
