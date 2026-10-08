import { Module } from '@nestjs/common';
import { LicensesService } from './licenses.service';
import { LicensesController } from './licenses.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [LicensesController],
  providers: [LicensesService],
  exports: [LicensesService],
})
export class LicensesModule {}
