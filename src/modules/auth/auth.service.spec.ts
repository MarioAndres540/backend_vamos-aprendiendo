import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PublicRegistrationRole, RegisterDto } from './dto/register.dto';
import { Role } from '../../common/enums/role.enum';

type QueryResult = { data: any; error: any; count?: number };

/**
 * Cliente de Supabase simulado: cada consulta se resuelve según "tabla:operación"
 * (ej. 'profiles:insert', 'students:delete'). Registra las operaciones para verificarlas.
 */
const createSupabaseMock = (results: Record<string, QueryResult> = {}) => {
  const calls: { table: string; op: string; payload?: any; filters: [string, any][] }[] = [];

  const from = jest.fn((table: string) => {
    let op = '';
    let call: (typeof calls)[number] | null = null;
    const resolve = () => Promise.resolve(results[`${table}:${op}`] ?? { data: null, error: null });
    const builder: any = {};
    for (const method of ['insert', 'update', 'delete', 'select']) {
      builder[method] = jest.fn((payload?: any) => {
        if (!op) {
          op = method;
          call = { table, op, payload, filters: [] };
          calls.push(call);
        }
        return builder;
      });
    }
    for (const method of ['eq', 'in', 'ilike']) {
      builder[method] = jest.fn((column: string, value: any) => {
        call?.filters.push([column, value]);
        return builder;
      });
    }
    builder.single = jest.fn(resolve);
    builder.then = (onFulfilled: any, onRejected: any) => resolve().then(onFulfilled, onRejected);
    return builder;
  });

  const auth = {
    signUp: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    admin: { deleteUser: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  };

  return { client: { from, auth }, calls };
};

const baseDto = (): RegisterDto =>
  ({
    role: PublicRegistrationRole.USER,
    firstName: 'Marisol',
    lastName: 'Villegas',
    documentType: 'CC',
    documentNumber: '1152451603',
    age: 35,
    email: 'tutor@ejemplo.com',
    phone: '3158417577',
    acceptedTerms: true,
    password: 'Clave123.',
    children: [
      {
        firstName: 'Matias',
        lastName: 'Jaramillo',
        documentType: 'TI',
        documentNumber: '5231478',
        birthDate: '2019-02-01',
        age: 7,
        grade: '2° Primaria',
      },
    ],
  }) as RegisterDto;

describe('AuthService - register', () => {
  let service: AuthService;
  let supabaseServiceMock: { getClient: jest.Mock; createAuthClient: jest.Mock };
  let authClientMock: { auth: { signUp: jest.Mock } };

  const setup = async (results: Record<string, QueryResult> = {}) => {
    const mock = createSupabaseMock(results);
    supabaseServiceMock.getClient.mockReturnValue(mock.client);
    // signUp va por un cliente desechable, separado del cliente administrativo
    authClientMock = { auth: { signUp: mock.client.auth.signUp } };
    supabaseServiceMock.createAuthClient.mockReturnValue(authClientMock);
    return mock;
  };

  beforeEach(async () => {
    // Silencia los logs esperados de los escenarios de error
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    supabaseServiceMock = { getClient: jest.fn(), createAuthClient: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseServiceMock },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('signed-token'),
            verify: jest.fn().mockReturnValue({ sub: 'user-1', email: 'tutor@ejemplo.com' }),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra un tutor con su estudiante sin iniciar sesión (no entrega tokens)', async () => {
    const mock = await setup({
      'students:insert': { data: { id: 'student-1' }, error: null },
    });

    const result = await service.register(baseDto());

    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result.user.id).toBe('user-1');
    expect(result.message).toContain('Inicia sesión');
    expect(mock.calls.some((c) => c.table === 'refresh_tokens')).toBe(false);

    const profileInsert = mock.calls.find((c) => c.table === 'profiles' && c.op === 'insert');
    expect(profileInsert?.payload).not.toHaveProperty('birth_date');
    expect(mock.calls.some((c) => c.table === 'tutor_students' && c.op === 'insert')).toBe(true);
    expect(mock.client.auth.admin.deleteUser).not.toHaveBeenCalled();
    // El alta en Auth se hace con el cliente desechable, no con el administrativo
    expect(supabaseServiceMock.createAuthClient).toHaveBeenCalledTimes(1);
  });

  it('responde 409 con mensaje claro si el correo ya está registrado en Auth', async () => {
    const mock = await setup();
    mock.client.auth.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered', code: 'user_already_exists' },
    });

    await expect(service.register(baseDto())).rejects.toThrow(
      new ConflictException('Este correo ya está registrado. Inicia sesión o recupera tu contraseña.'),
    );
    expect(mock.calls.some((c) => c.table === 'profiles')).toBe(false);
  });

  it('revierte el usuario de Auth y oculta el error técnico si falla la creación del perfil', async () => {
    const mock = await setup({
      'profiles:insert': {
        data: null,
        error: { code: 'PGRST204', message: "Could not find the 'birth_date' column of 'profiles' in the schema cache" },
      },
    });

    const promise = service.register(baseDto());

    await expect(promise).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(promise).rejects.toThrow('No pudimos crear tu perfil. Intenta de nuevo en unos minutos.');
    expect(mock.client.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    expect(mock.calls.some((c) => c.table === 'profiles' && c.op === 'delete')).toBe(true);
  });

  it('responde 409 si el documento ya existe (violación de unicidad) y revierte el registro', async () => {
    const mock = await setup({
      'profiles:insert': { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    });

    await expect(service.register(baseDto())).rejects.toBeInstanceOf(ConflictException);
    expect(mock.client.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('revierte estudiantes, perfil y usuario si falla el vínculo tutor-estudiante', async () => {
    const mock = await setup({
      'students:insert': { data: { id: 'student-1' }, error: null },
      'tutor_students:insert': { data: null, error: { code: '42501', message: 'permission denied' } },
    });

    await expect(service.register(baseDto())).rejects.toThrow(
      'No pudimos registrar al estudiante Matias Jaramillo. Revisa sus datos e intenta de nuevo.',
    );

    const studentDelete = mock.calls.find((c) => c.table === 'students' && c.op === 'delete');
    expect(studentDelete).toBeDefined();
    expect(mock.calls.some((c) => c.table === 'profiles' && c.op === 'delete')).toBe(true);
    expect(mock.client.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    // La licencia del titular no se crea si el registro falló antes
    expect(mock.calls.filter((c) => c.table === 'licenses').length).toBe(0);
  });

  describe('resolveProfileType', () => {
    it.each([
      [Role.ADMIN, 'admin'],
      [Role.TEACHER, 'profesor'],
      [Role.TEST, 'tester'],
    ])('el rol %s se resuelve como %s sin consultar la base', async (role, expected) => {
      const mock = await setup();
      await expect(service.resolveProfileType('user-1', role)).resolves.toBe(expected);
      expect(mock.client.from).not.toHaveBeenCalled();
    });

    it('un usuario con estudiantes vinculados es tutor', async () => {
      await setup({ 'tutor_students:select': { data: null, error: null, count: 2 } as QueryResult });
      await expect(service.resolveProfileType('user-1', Role.USER)).resolves.toBe('tutor');
    });

    it('un usuario sin estudiantes vinculados es adulto', async () => {
      await setup({ 'tutor_students:select': { data: null, error: null, count: 0 } as QueryResult });
      await expect(service.resolveProfileType('user-1', Role.USER)).resolves.toBe('adulto');
    });

    it('si la consulta falla, no bloquea el login y lo trata como adulto', async () => {
      await setup({ 'tutor_students:select': { data: null, error: { message: 'timeout' } } });
      await expect(service.resolveProfileType('user-1', Role.USER)).resolves.toBe('adulto');
    });
  });

  describe('sesiones simultáneas (app de Unity y web)', () => {
    const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

    it('un token reutilizado cierra solo su sesión, no las demás del usuario', async () => {
      const mock = await setup({
        'refresh_tokens:select': {
          data: { id: 'rt-1', is_revoked: true, session_id: 'sesion-web', expires_at: futureDate() },
          error: null,
        },
      });

      await expect(service.refreshTokens('token-reutilizado')).rejects.toThrow(
        'Tu sesión en este dispositivo se cerró por seguridad. Inicia sesión de nuevo.',
      );

      const revocations = mock.calls.filter((c) => c.table === 'refresh_tokens' && c.op === 'update');
      expect(revocations).toHaveLength(1);
      expect(revocations[0].filters).toEqual([['session_id', 'sesion-web']]);
      // Nunca se revocan todas las sesiones del usuario
      expect(revocations[0].filters.some(([column]) => column === 'user_id')).toBe(false);
    });

    it('al renovar, el token nuevo conserva la misma sesión', async () => {
      const mock = await setup({
        'refresh_tokens:select': {
          data: { id: 'rt-2', is_revoked: false, session_id: 'sesion-unity', expires_at: futureDate() },
          error: null,
        },
        'profiles:select': {
          data: { role: Role.USER, trial_ends_at: null, is_active: true, has_completed_setup: true },
          error: null,
        },
      });

      await service.refreshTokens('token-valido');

      const insert = mock.calls.find((c) => c.table === 'refresh_tokens' && c.op === 'insert');
      expect(insert?.payload.session_id).toBe('sesion-unity');
    });

    it('cada inicio de sesión crea una sesión distinta con un token único', async () => {
      const mock = await setup();
      const jwt = (service as any).jwtService;
      jwt.sign.mockImplementation((payload: any) => JSON.stringify(payload));

      const web = await (service as any).generateTokenPair('user-1', 'tutor@ejemplo.com', Role.USER);
      const unity = await (service as any).generateTokenPair('user-1', 'tutor@ejemplo.com', Role.USER);

      const inserts = mock.calls.filter((c) => c.table === 'refresh_tokens' && c.op === 'insert');
      expect(inserts).toHaveLength(2);
      expect(inserts[0].payload.session_id).not.toBe(inserts[1].payload.session_id);
      expect(web.refreshToken).not.toBe(unity.refreshToken);
      expect(inserts[0].payload.token_hash).not.toBe(inserts[1].payload.token_hash);
    });

    it('sin la columna session_id (migración pendiente) reintenta guardar el token sin esa columna', async () => {
      // El mock responde igual a ambos inserts, así que el reintento también falla: se valida que exista
      // el reintento sin session_id y que el error final sea un mensaje claro
      const mock = await setup({
        'refresh_tokens:insert': {
          data: null,
          error: { code: 'PGRST204', message: "Could not find the 'session_id' column of 'refresh_tokens'" },
        },
      });

      await expect(
        (service as any).generateTokenPair('user-1', 'tutor@ejemplo.com', Role.USER),
      ).rejects.toThrow('No pudimos iniciar tu sesión');

      const inserts = mock.calls.filter((c) => c.table === 'refresh_tokens' && c.op === 'insert');
      expect(inserts).toHaveLength(2);
      expect(inserts[1].payload).not.toHaveProperty('session_id');
    });
  });

  it('mantiene el mensaje claro aunque la reversión en Auth falle', async () => {
    const mock = await setup({
      'profiles:insert': { data: null, error: { code: 'XX000', message: 'unexpected' } },
    });
    mock.client.auth.admin.deleteUser.mockResolvedValue({ data: null, error: { message: 'User not allowed' } });

    await expect(service.register(baseDto())).rejects.toThrow(
      'No pudimos crear tu perfil. Intenta de nuevo en unos minutos.',
    );
  });
});
