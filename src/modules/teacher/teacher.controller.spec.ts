import { Test, TestingModule } from '@nestjs/testing';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';

describe('TeacherController', () => {
    let controller: TeacherController;

    const mockTeacherService = {
        getDashboard: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TeacherController],
            providers: [
                {
                    provide: TeacherService,
                    useValue: mockTeacherService,
                },
            ],
        }).compile();

        controller = module.get<TeacherController>(TeacherController);
    });

    it('debe estar definido el controlador', () => {
        expect(controller).toBeDefined();
    });
});