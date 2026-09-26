import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateStudentSetupDto } from './dto/create-student-setup.dto';

@Injectable()
export class StudentsService {
  constructor(private readonly supabaseService: SupabaseService) { }

  /**
   * Guarda o actualiza el diagnostico del estudiante en Supabase.
   * Ademas marca has_completed_setup = true en la tabla profiles.
   */
  async saveSetup(userId: string, dto: CreateStudentSetupDto): Promise<{ success: boolean }> {
    const supabase = this.supabaseService.getClient();

    // 1. Upsert en student_profiles
    const { error: upsertError } = await supabase
      .from('students')
      .upsert(
        {
          user_id: userId,
          mode: dto.mode,
          super_power: dto.superPower ?? null,
          chosen_realm: dto.chosenRealm ?? null,
          self_efficacy: dto.selfEfficacy ?? null,
          play_styles: dto.playStyles ?? null,
          cognitive_goal: dto.cognitiveGoal ?? null,
          learning_style: dto.learningStyle ?? null,
          topic_interests: dto.topicInterests ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (upsertError) {
      throw new InternalServerErrorException(
        `Error al guardar el perfil del estudiante: ${upsertError.message}`,
      );
    }

    // 2. Marcar has_completed_setup = true en profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ has_completed_setup: true })
      .eq('id', userId);

    if (profileError) {
      throw new InternalServerErrorException(
        `Error al actualizar el estado de setup: ${profileError.message}`,
      );
    }

    return { success: true };
  }

  /**
   * Verifica si el usuario ya completo el diagnostico inicial.
   */
  async getSetupStatus(userId: string): Promise<{ hasCompletedSetup: boolean }> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('has_completed_setup')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return { hasCompletedSetup: false };
    }

    return { hasCompletedSetup: data.has_completed_setup === true };
  }
}
