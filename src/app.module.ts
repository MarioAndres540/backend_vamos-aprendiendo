import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PresenceModule } from './modules/presence/presence.module';
import { StudentsModule } from './modules/students/students.module';
import { InstitutionsModule } from './modules/institutions/institutions.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SupabaseModule,
    AuthModule,
    AdminModule,
    TeacherModule,
    PresenceModule,
    StudentsModule,
    InstitutionsModule,
    LicensesModule,
    AssessmentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
