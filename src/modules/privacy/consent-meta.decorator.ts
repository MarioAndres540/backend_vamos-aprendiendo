import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ConsentMeta } from './privacy.constants';

/**
 * Prueba de la autorización (Decreto 1377, art. 8): IP y navegador desde donde se otorgó.
 * En producción req.ip es la IP real del cliente porque la app confía en el proxy de Render (spec 0002).
 */
export const ConsentMetaParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ConsentMeta => {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const userAgent = req.headers?.['user-agent'];
    return {
      ip: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    };
  },
);
