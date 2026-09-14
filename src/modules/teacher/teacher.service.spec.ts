import { Test, TestingModule } from '@nestjs/testing';
import { TeacherService } from './teacher.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('TeacherService', () => {
    let service: TeacherService;

    const mockSupabaseService = {
        getClient: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TeacherService,
                {
                    provide: SupabaseService,
                    useValue: mockSupabaseService,
                },
            ],
        }).compile();

        service = module.get<TeacherService>(TeacherService);
    });

    it('debe estar definido el servicio', () => {
        expect(service).toBeDefined();
    });
});