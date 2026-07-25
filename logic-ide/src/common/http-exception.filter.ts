import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class JsonErrorFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { error: body } : { error: (body as any).error || (body as any).message || err.message, code: (body as any).code });
    }
    res.status(err?.status || 500).json({ error: err?.message || 'Internal error' });
  }
}
