import { Test, TestingModule } from '@nestjs/testing';
import { LicensesService } from './licenses.service';
import { SupabaseService } from '../supabase/supabase.service';
import { LicensePlan } from './dto/create-license.dto';

describe('LicensesService', () => {
  let service: LicensesService;
  let supabaseMock: any;

  beforeEach(async () => {
    supabaseMock = {
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensesService,
        {
          provide: SupabaseService,
          useValue: supabaseMock,
        },
      ],
    }).compile();

    service = module.get<LicensesService>(LicensesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should resolve Pro license when pro license exists and is active', async () => {
    supabaseMock.getClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'lic-1',
                  plan_type: 'pro',
                  origin: 'personal',
                  starts_at: new Date().toISOString(),
                  expires_at: null,
                  is_active: true,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const result = await service.getEffectiveLicense('user-1');
    expect(result.planType).toBe(LicensePlan.PRO);
    expect(result.features.unlimitedActivities).toBe(true);
  });
});
