import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { Role } from '../enums/role.enum';

@Injectable()
export class ActiveAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return true;
    }

    if (user.isActive === false) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        code: 'ACCOUNT_DISABLED',
        message: 'Tu cuenta se encuentra desactivada. Contacta al administrador.',
      });
    }

    // Admin y Usuario regular tienen acceso permanente
    if (user.role === Role.ADMIN || user.role === Role.USER) {
      return true;
    }

    // Rol Test: Validar si los 14 días siguen vigentes
    if (user.role === Role.TEST) {
      if (!user.trialEndsAt || new Date() > new Date(user.trialEndsAt)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: 'TRIAL_EXPIRED',
          message:
            'Tu periodo de prueba de 14 días ha finalizado. Por favor actualiza tu suscripción para continuar accediendo a todas las funciones.',
        });
      }
    }

    return true;
  }
}
