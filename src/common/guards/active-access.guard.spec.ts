import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ActiveAccessGuard } from './active-access.guard';
import { Role } from '../enums/role.enum';

describe('ActiveAccessGuard', () => {
  let guard: ActiveAccessGuard;

  beforeEach(() => {
    guard = new ActiveAccessGuard();
  });

  const mockExecutionContext = (user?: any): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('debe permitir acceso si no hay usuario presente', () => {
    const context = mockExecutionContext(null);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe lanzar ForbiddenException si la cuenta del usuario está desactivada', () => {
    const context = mockExecutionContext({
      role: Role.USER,
      isActive: false,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('debe permitir acceso sin restricciones si el rol es Admin', () => {
    const context = mockExecutionContext({
      role: Role.ADMIN,
      isActive: true,
      trialEndsAt: null,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso sin restricciones si el rol es Usuario', () => {
    const context = mockExecutionContext({
      role: Role.USER,
      isActive: true,
      trialEndsAt: null,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso a un usuario Test con periodo de prueba vigente (<= 14 días)', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const context = mockExecutionContext({
      role: Role.TEST,
      isActive: true,
      trialEndsAt: futureDate,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe lanzar ForbiddenException si el periodo de prueba del usuario Test ya expiró (> 14 días)', () => {
    const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const context = mockExecutionContext({
      role: Role.TEST,
      isActive: true,
      trialEndsAt: pastDate,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
