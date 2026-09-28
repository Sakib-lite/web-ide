import { HttpException } from '@nestjs/common';

export function fail(message: string, status = 400, code?: string): never {
  throw new HttpException({ error: message, code }, status);
}

export function errorStatus(err: any): number {
  return err?.status || err?.getStatus?.() || 500;
}
