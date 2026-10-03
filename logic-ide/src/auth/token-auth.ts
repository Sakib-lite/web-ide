import type { IncomingMessage } from 'node:http';
import type { Express, Request, Response, NextFunction } from 'express';
import { IDE_TOKEN } from '../config/paths';

const COOKIE = 'ide_token';

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  return (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
}

export function isAuthorized(req: IncomingMessage): boolean {
  return !IDE_TOKEN || readCookie(req, COOKIE) === IDE_TOKEN || req.headers['x-ide-token'] === IDE_TOKEN;
}

export function installTokenAuth(app: Express) {
  if (!IDE_TOKEN) return;
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('token') === IDE_TOKEN) {
      res.setHeader('Set-Cookie', `${COOKIE}=${IDE_TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
      url.searchParams.delete('token');
      return res.redirect(url.pathname + url.search);
    }
    if (isAuthorized(req)) return next();
    res.status(401).json({ error: 'Unauthorized: open the IDE with ?token=… first', code: 'AUTH' });
  });
}
