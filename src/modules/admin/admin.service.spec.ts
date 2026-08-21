import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { SupabaseService } from '../supabase/supabase.service';
import { NotFoundException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';

describe('AdminService', () => {
  let service: AdminService;
  let supabaseServiceMock: any;

  const mockProfile = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    first_name: 'Carlos',
    last_name: 'Gomez',
    role: Role.TEST,
    trial_ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    is_active: true,
  };

  beforeEach(async () => {
    supabaseServiceMock = {
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: SupabaseService,
          useValue: supabaseServiceMock,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('debe retornar el perfil del usuario si existe', async () => {
      supabaseServiceMock.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockProfile, error: null }),
            }),
          }),
        }),
      });

      const result = await service.findById(mockProfile.id);
      expect(result.id).toBe(mockProfile.id);
      expect(result.days_remaining).toBeGreaterThanOrEqual(9);
    });

    it('debe lanzar NotFoundException si el usuario no existe', async () => {
      supabaseServiceMock.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
            }),
          }),
        }),
      });

      await expect(service.findById('non-existing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('extendTrial', () => {
    it('debe extender los días de prueba para un usuario', async () => {
      const updatedProfile = {
        ...mockProfile,
        trial_ends_at: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000).toISOString(),
      };

      supabaseServiceMock.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockProfile, error: null }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: updatedProfile, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await service.extendTrial(mockProfile.id, { days: 14 });
      expect(result.message).toContain('Periodo de prueba extendido');
      expect(result.user.trial_ends_at).toBeDefined();
    });
  });
});
