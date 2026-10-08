import { Test, TestingModule } from '@nestjs/testing';
import { InstitutionsService } from './institutions.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('InstitutionsService', () => {
  let service: InstitutionsService;
  let supabaseMock: any;

  beforeEach(async () => {
    supabaseMock = {
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstitutionsService,
        {
          provide: SupabaseService,
          useValue: supabaseMock,
        },
      ],
    }).compile();

    service = module.get<InstitutionsService>(InstitutionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkTeacherPreauth', () => {
    it('should authorize teacher if preauth record exists and is not registered', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue({ id: 'inst-1', name: 'Colegio Test' });

      supabaseMock.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                ilike: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { id: 'preauth-1', full_name: 'Profesor Test', is_registered: false },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.checkTeacherPreauth({
        institutionId: 'inst-1',
        documentNumber: '1020304050',
        email: 'profe@test.edu',
      });

      expect(result.isAuthorized).toBe(true);
      expect(result.preauthId).toBe('preauth-1');
    });

    it('should throw ForbiddenException if teacher is not in preauth list', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue({ id: 'inst-1', name: 'Colegio Test' });

      supabaseMock.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                ilike: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Not found' },
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      await expect(
        service.checkTeacherPreauth({
          institutionId: 'inst-1',
          documentNumber: '00000000',
          email: 'unauthorized@test.edu',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
