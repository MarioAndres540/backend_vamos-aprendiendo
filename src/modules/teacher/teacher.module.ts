import { Module } from '@nestjs/common';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';
import { TeacherAccessService } from './teacher-access.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
    imports: [SupabaseModule],
    controllers: [TeacherController],
    providers: [TeacherService, TeacherAccessService],
    exports: [TeacherService],
})
export class TeacherModule { }