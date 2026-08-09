import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('HTTP');

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const ctx = context.switchToHttp();
        const request = ctx.getRequest<Request>();
        const response = ctx.getResponse<Response>();

        const { method, originalUrl } = request;
        const userAgent = request.get('user-agent') || '';
        const ip = request.ip;
        const startTime = Date.now();

        return next.handle().pipe(
            tap(() => {
                const { statusCode } = response;
                const elapsedTime = Date.now() - startTime;

                this.logger.log(
                    `${method} ${originalUrl} ${statusCode} - ${elapsedTime}ms [IP: ${ip}] [UA: ${userAgent}]`,
                );
            }),
        );
    }
}
