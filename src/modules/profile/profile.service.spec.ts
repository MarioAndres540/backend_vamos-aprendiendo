import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { SupabaseService } from '../supabase/supabase.service';
import { DocumentType } from '../auth/dto/register.dto';

type QueryResult = { data?: any; error?: any };

/**
 * Cliente de Supabase simulado: cada consulta "tabla:operación" toma el siguiente resultado de su cola
 * (si la cola se vacía, responde sin datos). Registra operaciones, payloads y filtros.
 */
const createSupabaseMock = (queues: Record<string, QueryResult[]> = {}) => {
  const calls: {
    table: string;
    op: string;
    payload?: any;
    filters: any[][];
  }[] = [];

  const from = jest.fn((table: string) => {
    let op = '';
    let call: (typeof calls)[number] | null = null;
    const next = () =>
      Promise.resolve(
        queues[`${table}:${op}`]?.shift() ?? { data: null, error: null },
      );
    const builder: any = {};
    for (const method of ['update', 'select']) {
      builder[method] = jest.fn((payload?: any) => {
        if (!op) {
          op = method;
          call = { table, op, payload, filters: [] };
          calls.push(call);
        }
        return builder;
      });
    }
    builder.eq = jest.fn((...args: any[]) => {
      call?.filters.push(['eq', ...args]);
      return builder;
    });
    builder.maybeSingle = jest.fn(next);
    builder.then = (onFulfilled: any, onRejected: any) =>
      next().then(onFulfilled, onRejected);
    return builder;
  });

  const updateUserById = jest.fn().mockResolvedValue({ data: {}, error: null });
  return {
    client: { from, auth: { admin: { updateUserById } } },
    calls,
    updateUserById,
  };
};

const profileRow = {
  id: 'tutor-1',
  email: 'marisol@example.com',
  first_name: 'Marisol',
  last_name: 'Vice',
  document_type: 'CC',
  document_number: '1112223334',
  phone: '3001234567',
};

describe('ProfileService (Configuración del tutor)', () => {
  let service: ProfileService;
  let supabaseServiceMock: {
    getClient: jest.Mock;
    createAuthClient: jest.Mock;
  };
  let signInWithPassword: jest.Mock;

  const setup = (queues: Record<string, QueryResult[]> = {}) => {
    const mock = createSupabaseMock(queues);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    return mock;
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    signInWithPassword = jest
      .fn()
      .mockResolvedValue({ data: { user: { id: 'tutor-1' } }, error: null });
    supabaseServiceMock = {
      getClient: jest.fn(),
      createAuthClient: jest.fn(() => ({ auth: { signInWithPassword } })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getMe', () => {
    it('devuelve los datos personales en camelCase', async () => {
      setup({ 'profiles:select': [{ data: profileRow, error: null }] });

      await expect(service.getMe('tutor-1')).resolves.toEqual({
        id: 'tutor-1',
        email: 'marisol@example.com',
        firstName: 'Marisol',
        lastName: 'Vice',
        documentType: 'CC',
        documentNumber: '1112223334',
        phone: '3001234567',
      });
    });

    it('responde 404 si el perfil no existe', async () => {
      setup({ 'profiles:select': [{ data: null, error: null }] });

      await expect(service.getMe('tutor-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateMe', () => {
    it('guarda solo el teléfono y el tipo de documento', async () => {
      const mock = setup({
        'profiles:update': [
          {
            data: { ...profileRow, phone: '3109998877', document_type: 'CE' },
            error: null,
          },
        ],
      });

      const result = await service.updateMe('tutor-1', {
        phone: ' 3109998877 ',
        documentType: DocumentType.CE,
      });

      expect(result).toMatchObject({ phone: '3109998877', documentType: 'CE' });
      const update = mock.calls.find((c) => c.op === 'update');
      expect(update?.payload).toMatchObject({
        phone: '3109998877',
        document_type: 'CE',
      });
      expect(update?.filters).toContainEqual(['eq', 'id', 'tutor-1']);
    });

    it('responde 400 si no hay cambios', async () => {
      setup();

      await expect(service.updateMe('tutor-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('responde 500 con mensaje genérico si falla la base de datos', async () => {
      setup({
        'profiles:update': [{ data: null, error: { message: 'timeout' } }],
      });

      await expect(
        service.updateMe('tutor-1', { phone: '3001234567' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('updateEmail', () => {
    it('confirma la contraseña y cambia el correo en Auth y en profiles', async () => {
      const mock = setup({
        'profiles:select': [{ data: profileRow, error: null }],
        'profiles:update': [{ data: null, error: null }],
      });

      const result = await service.updateEmail('tutor-1', {
        email: 'Nuevo@Example.com',
        currentPassword: 'secreta',
      });

      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'marisol@example.com',
        password: 'secreta',
      });
      expect(mock.updateUserById).toHaveBeenCalledWith('tutor-1', {
        email: 'nuevo@example.com',
        email_confirm: true,
      });
      expect(mock.calls.find((c) => c.op === 'update')?.payload).toMatchObject({
        email: 'nuevo@example.com',
      });
      expect(result.email).toBe('nuevo@example.com');
    });

    it('responde 400 si la contraseña no es correcta y no cambia nada', async () => {
      const mock = setup({
        'profiles:select': [{ data: profileRow, error: null }],
      });
      signInWithPassword.mockResolvedValue({
        data: {},
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.updateEmail('tutor-1', {
          email: 'nuevo@example.com',
          currentPassword: 'mala',
        }),
      ).rejects.toThrow('La contraseña actual no es correcta.');
      expect(mock.updateUserById).not.toHaveBeenCalled();
    });

    it('responde 400 si el correo nuevo es igual al actual', async () => {
      setup({ 'profiles:select': [{ data: profileRow, error: null }] });

      await expect(
        service.updateEmail('tutor-1', {
          email: 'MARISOL@example.com',
          currentPassword: 'secreta',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it('responde 409 si el correo ya es de otra cuenta', async () => {
      const mock = setup({
        'profiles:select': [{ data: profileRow, error: null }],
      });
      mock.updateUserById.mockResolvedValue({
        data: null,
        error: { code: 'email_exists', message: 'exists' },
      });

      await expect(
        service.updateEmail('tutor-1', {
          email: 'otro@example.com',
          currentPassword: 'secreta',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('si falla profiles devuelve el correo anterior en Auth', async () => {
      const mock = setup({
        'profiles:select': [{ data: profileRow, error: null }],
        'profiles:update': [{ data: null, error: { message: 'timeout' } }],
      });

      await expect(
        service.updateEmail('tutor-1', {
          email: 'nuevo@example.com',
          currentPassword: 'secreta',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(mock.updateUserById).toHaveBeenLastCalledWith('tutor-1', {
        email: 'marisol@example.com',
        email_confirm: true,
      });
    });
  });
});
