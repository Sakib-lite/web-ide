import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { logError } from './error-log';

@Catch()
export class JsonErrorFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = err instanceof HttpException ? err.getStatus() : err?.status || 500;
    if (status >= 500) this.log(err, host);
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(status).json(typeof body === 'string' ? { error: body } : { error: (body as any).error || (body as any).message || err.message, code: (body as any).code });
    }
    res.status(status).json({ error: err?.message || 'Internal error' });
  }

  private log(err: any, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    logError('backend', { message: err?.message || String(err), context: req ? `${req.method} ${req.originalUrl}` : undefined, stack: err?.stack });
  }
}
