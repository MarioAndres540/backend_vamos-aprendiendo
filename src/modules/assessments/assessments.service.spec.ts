import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService } from '../privacy/privacy.service';
import { AssessmentTarget } from './dto/submit-assessment.dto';

describe('AssessmentsService', () => {
  let service: AssessmentsService;
  let supabaseMock: any;
  let privacyMock: { hasSensitiveDataConsent: jest.Mock };

  beforeEach(async () => {
    // Por defecto la persona autorizó los datos sensibles (spec 0004)
    privacyMock = { hasSensitiveDataConsent: jest.fn().mockResolvedValue(true) };

    supabaseMock = {
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssessmentsService,
        {
          provide: SupabaseService,
          useValue: supabaseMock,
        },
        { provide: PrivacyService, useValue: privacyMock },
      ],
    }).compile();

    service = module.get<AssessmentsService>(AssessmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Ley 1581 (spec 0004, PD-SENS)
  describe('datos sensibles', () => {
    const answers = Array.from({ length: 5 }, (_, i) => ({
      questionId: i + 1,
      dimension: 'atencion',
      score: 1,
    }));

    it('PD-SENS-01: sin autorización de datos sensibles responde 403 con código y no guarda nada', async () => {
      privacyMock.hasSensitiveDataConsent.mockResolvedValue(false);
      const from = jest.fn();
      supabaseMock.getClient.mockReturnValue({ from });

      const promise = service.submitAssessment('user-1', {
        targetType: AssessmentTarget.ADULTO,
        answers,
      });

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'SENSITIVE_CONSENT_REQUIRED' },
      });
      expect(from).not.toHaveBeenCalled();
    });

    it('PD-SENS-02: omitir la evaluación marca la configuración completa sin guardar respuestas', async () => {
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({ eq });
      const from = jest.fn().mockReturnValue({ update });
      supabaseMock.getClient.mockReturnValue({ from });

      await expect(service.skipAssessment('user-1')).resolves.toEqual({ skipped: true });
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('profiles');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ has_completed_setup: true }),
      );
      expect(eq).toHaveBeenCalledWith('id', 'user-1');
    });
  });

  it('should calculate score and determine low risk for kids when score is <= 15', async () => {
    const mockInsert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'assess-1', created_at: new Date().toISOString() },
          error: null,
        }),
      }),
    });

    const mockUpdate = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    supabaseMock.getClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'initial_assessments') {
          return { insert: mockInsert };
        }
        if (table === 'profiles') {
          return { update: mockUpdate };
        }
        return {};
      }),
    });

    const result = await service.submitAssessment('user-1', {
      targetType: AssessmentTarget.NINO,
      answers: [
        { questionId: 1, dimension: 'dislexia', score: 1 },
        { questionId: 2, dimension: 'lectoescritura', score: 1 },
        { questionId: 3, dimension: 'discalculia', score: 1 },
        { questionId: 4, dimension: 'discalculia', score: 2 },
        { questionId: 5, dimension: 'tdah', score: 1 },
      ],
    });

    expect(result.totalScore).toBe(6);
    expect(result.riskLevel).toBe('bajo');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ has_completed_setup: true }),
    );
  });

  describe('formulario de un estudiante (studentId)', () => {
    const answers = [1, 2, 3, 4, 5].map((questionId) => ({
      questionId,
      dimension: 'dislexia',
      score: 2,
    }));

    const mockClient = (link: { id: string } | null) => {
      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'assess-2', created_at: '2026-10-25T10:00:00Z' },
            error: null,
          }),
        }),
      });
      const linkQuery: any = {
        select: jest.fn(() => linkQuery),
        eq: jest.fn(() => linkQuery),
        maybeSingle: jest.fn().mockResolvedValue({ data: link, error: null }),
      };
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'tutor_students') return linkQuery;
          if (table === 'initial_assessments') return { insert: mockInsert };
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }),
      });
      return { mockInsert, linkQuery };
    };

    it('guarda el formulario con el studentId cuando el estudiante es del tutor', async () => {
      const { mockInsert, linkQuery } = mockClient({ id: 'link-1' });

      await service.submitAssessment('tutor-1', {
        targetType: AssessmentTarget.NINO,
        studentId: 'est-1',
        answers,
      });

      expect(linkQuery.eq).toHaveBeenCalledWith('tutor_profile_id', 'tutor-1');
      expect(linkQuery.eq).toHaveBeenCalledWith('student_id', 'est-1');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ student_id: 'est-1' }),
      );
    });

    it('responde 403 si el estudiante no está vinculado a la cuenta', async () => {
      const { mockInsert } = mockClient(null);

      await expect(
        service.submitAssessment('tutor-1', {
          targetType: AssessmentTarget.NINO,
          studentId: 'ajeno',
          answers,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('getHistory (pestaña Diagnósticos)', () => {
    const mockClient = (link: { id: string } | null) => {
      const historyQuery: any = {
        select: jest.fn(() => historyQuery),
        order: jest.fn(() => historyQuery),
        eq: jest.fn(() => historyQuery),
        then: (resolve: any) =>
          Promise.resolve({ data: [{ id: 'eval-1' }], error: null }).then(
            resolve,
          ),
      };
      const linkQuery: any = {
        select: jest.fn(() => linkQuery),
        eq: jest.fn(() => linkQuery),
        maybeSingle: jest.fn().mockResolvedValue({ data: link, error: null }),
      };
      const from = jest.fn((table: string) =>
        table === 'tutor_students' ? linkQuery : historyQuery,
      );
      supabaseMock.getClient.mockReturnValue({ from });
      return { from, historyQuery };
    };

    it('devuelve los formularios del estudiante cuando es del tutor', async () => {
      const { historyQuery } = mockClient({ id: 'link-1' });

      await expect(service.getHistory('tutor-1', 'est-1')).resolves.toEqual([
        { id: 'eval-1' },
      ]);
      expect(historyQuery.eq).toHaveBeenCalledWith('student_id', 'est-1');
    });

    it('responde 403 con un estudiante de otra cuenta y no consulta el historial', async () => {
      const { from } = mockClient(null);

      await expect(
        service.getHistory('tutor-1', 'ajeno'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(from).not.toHaveBeenCalledWith('initial_assessments');
    });

    it('sin studentId devuelve los formularios que llenó el usuario', async () => {
      const { from, historyQuery } = mockClient(null);

      await service.getHistory('adulto-1');

      expect(from).not.toHaveBeenCalledWith('tutor_students');
      expect(historyQuery.eq).toHaveBeenCalledWith(
        'evaluator_profile_id',
        'adulto-1',
      );
    });
  });
});
