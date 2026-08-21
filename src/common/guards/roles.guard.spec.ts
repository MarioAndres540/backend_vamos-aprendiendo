import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const mockExecutionContext = (user?: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('debe permitir acceso si la ruta no requiere roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);

    const context = mockExecutionContext({ role: Role.USER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el usuario es Admin independientemente del rol requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);

    const context = mockExecutionContext({ role: Role.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe permitir acceso si el rol del usuario coincide con los requeridos', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER, Role.TEST]);

    const context = mockExecutionContext({ role: Role.USER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('debe lanzar ForbiddenException si el usuario no tiene el rol requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = mockExecutionContext({ role: Role.USER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('debe lanzar ForbiddenException si no hay usuario en la request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.USER]);

    const context = mockExecutionContext(null);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
