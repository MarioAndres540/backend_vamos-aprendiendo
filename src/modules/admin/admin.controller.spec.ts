import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { Role } from '../../common/enums/role.enum';

describe('AdminController', () => {
  let controller: AdminController;
  let adminServiceMock: any;

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'admin@ejemplo.com',
    role: Role.ADMIN,
    is_active: true,
  };

  beforeEach(async () => {
    adminServiceMock = {
      findAll: jest.fn().mockResolvedValue({ data: [mockUser], meta: { total: 1 } }),
      findById: jest.fn().mockResolvedValue(mockUser),
      updateUser: jest.fn().mockResolvedValue({ message: 'Updated', user: mockUser }),
      updateEmail: jest.fn().mockResolvedValue({ message: 'Email updated', email: 'new@email.com' }),
      extendTrial: jest.fn().mockResolvedValue({ message: 'Extended' }),
      deleteUser: jest.fn().mockResolvedValue({ message: 'Deleted' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: adminServiceMock,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe retornar lista de usuarios en findAll', async () => {
    const result = await controller.findAll({});
    expect(result.data).toHaveLength(1);
    expect(adminServiceMock.findAll).toHaveBeenCalled();
  });

  it('debe retornar un usuario por ID en findById', async () => {
    const result = await controller.findById(mockUser.id);
    expect(result.id).toBe(mockUser.id);
    expect(adminServiceMock.findById).toHaveBeenCalledWith(mockUser.id);
  });
});
