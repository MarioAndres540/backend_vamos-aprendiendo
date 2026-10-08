import { Test, TestingModule } from '@nestjs/testing';
import { AssessmentsService } from './assessments.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AssessmentTarget } from './dto/submit-assessment.dto';

describe('AssessmentsService', () => {
  let service: AssessmentsService;
  let supabaseMock: any;

  beforeEach(async () => {
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
      ],
    }).compile();

    service = module.get<AssessmentsService>(AssessmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ has_completed_setup: true }));
  });
});
