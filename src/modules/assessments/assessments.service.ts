import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SubmitAssessmentDto, AssessmentTarget } from './dto/submit-assessment.dto';

export interface AssessmentResult {
  id: string;
  totalScore: number;
  maxScore: number;
  riskLevel: 'bajo' | 'moderado' | 'alto';
  primaryCondition: string;
  recommendations: string;
  targetType: AssessmentTarget;
  createdAt: string;
}

@Injectable()
export class AssessmentsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Procesa las respuestas del formulario inicial, calcula el score ponderado,
   * asigna el nivel de riesgo/área y marca has_completed_setup = true.
   */
  async submitAssessment(evaluatorUserId: string, dto: SubmitAssessmentDto): Promise<AssessmentResult> {
    const supabase = this.supabaseService.getClient();

    // 1. Calcular puntuación total
    const totalScore = dto.answers.reduce((sum, item) => sum + item.score, 0);
    const maxScore = dto.answers.length * 5;

    // 2. Determinar dimensión con mayor puntaje acumulado
    const dimensionScores: Record<string, number> = {};
    for (const ans of dto.answers) {
      dimensionScores[ans.dimension] = (dimensionScores[ans.dimension] || 0) + ans.score;
    }

    let primaryCondition = 'general';
    let highestScore = -1;
    for (const [dim, score] of Object.entries(dimensionScores)) {
      if (score > highestScore) {
        highestScore = score;
        primaryCondition = dim;
      }
    }

    // 3. Determinar nivel de riesgo y recomendaciones según el perfil
    let riskLevel: 'bajo' | 'moderado' | 'alto' = 'bajo';
    let recommendations = '';

    if (dto.targetType === AssessmentTarget.NINO) {
      if (totalScore <= 15) {
        riskLevel = 'bajo';
        recommendations = 'Perfil de aprendizaje típico. Ruta recomendada: Estimulación lúdica integral y retos progresivos.';
      } else if (totalScore <= 25) {
        riskLevel = 'moderado';
        recommendations = `Alerta moderada detectada en el área de ${primaryCondition}. Ruta recomendada: Refuerzo guiado y ejercicios adaptativos.`;
      } else {
        riskLevel = 'alto';
        recommendations = `Alerta significativa detectada con prevalencia en ${primaryCondition}. Se sugiere ruta pedagógica adaptada y valoración complementaria.`;
      }
    } else {
      // ADULTO
      if (totalScore <= 12) {
        riskLevel = 'bajo';
        recommendations = 'Rendimiento cognitivo óptimo. Ruta recomendada: Gimnasia mental diaria, agilidad y razonamiento.';
      } else if (totalScore <= 22) {
        riskLevel = 'moderado';
        recommendations = `Signos de desgaste leve en ${primaryCondition}. Ruta recomendada: Ejercicios de neuroprotección y memoria activa.`;
      } else {
        riskLevel = 'alto';
        recommendations = `Dificultades notorias observadas en ${primaryCondition}. Ruta recomendada: Apoyo cognitivo estructurado y seguimiento evolutivo.`;
      }
    }

    // 4. Guardar en tabla initial_assessments
    const { data: assessmentRecord, error: insertError } = await supabase
      .from('initial_assessments')
      .insert({
        evaluator_profile_id: evaluatorUserId,
        student_id: dto.studentId || null,
        target_type: dto.targetType,
        total_score: totalScore,
        max_score: maxScore,
        risk_level: riskLevel,
        primary_condition: primaryCondition,
        answers: dto.answers,
        recommendations: recommendations,
      })
      .select()
      .single();

    if (insertError) {
      throw new InternalServerErrorException(
        `Error al registrar evaluación inicial: ${insertError.message}`,
      );
    }

    // 5. Actualizar has_completed_setup = true en el perfil del evaluador
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ has_completed_setup: true, updated_at: new Date().toISOString() })
      .eq('id', evaluatorUserId);

    if (profileError) {
      throw new InternalServerErrorException(
        `Error al actualizar estado de configuración: ${profileError.message}`,
      );
    }

    return {
      id: assessmentRecord.id,
      totalScore,
      maxScore,
      riskLevel,
      primaryCondition,
      recommendations,
      targetType: dto.targetType,
      createdAt: assessmentRecord.created_at,
    };
  }

  /**
   * Obtiene el historial de evaluaciones de un estudiante o del usuario evaluador
   */
  async getHistory(userId: string, studentId?: string) {
    const supabase = this.supabaseService.getClient();

    let query = supabase
      .from('initial_assessments')
      .select('*')
      .order('created_at', { ascending: false });

    if (studentId) {
      query = query.eq('student_id', studentId);
    } else {
      query = query.eq('evaluator_profile_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(`Error al consultar historial: ${error.message}`);
    }

    return data || [];
  }
}
