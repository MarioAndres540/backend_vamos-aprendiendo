export interface AssessmentDimensionScore {
  questionId: number;
  dimension: string;
  // 1 (nunca) a 5 (siempre): un puntaje alto indica más dificultad en la dimensión
  score: number;
}

export interface StudentAssessmentSummary {
  id: string;
  targetType: 'nino' | 'adulto';
  totalScore: number;
  maxScore: number;
  riskLevel: 'bajo' | 'moderado' | 'alto';
  primaryCondition: string | null;
  recommendations: string | null;
  answers: AssessmentDimensionScore[];
  createdAt: string;
}

export interface MyStudent {
  id: string;
  firstName: string;
  lastName: string;
  documentType: string | null;
  documentNumber: string | null;
  grade: string | null;
  age: number | null;
  birthDate: string | null;
  relationship: string | null;
  institution: { id: string; name: string } | null;
  latestAssessment: StudentAssessmentSummary | null;
}

export interface MyStudentsResponse {
  totalStudents: number;
  students: MyStudent[];
}
