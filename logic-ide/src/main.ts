import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { JsonErrorFilter } from './common/http-exception.filter';
import { installTokenAuth } from './auth/token-auth';
import { installWebSockets } from './ws/upgrade';
import { ProjectsService } from './projects/projects.service';
import { PluginHost } from './plugins/plugin-host';
import { PORT, UI_ORIGINS } from './config/paths';
import { logError } from './common/error-log';

process.on('uncaughtException', (err) => logError('backend', { message: err.message, context: 'uncaughtException', stack: err.stack }));
process.on('unhandledRejection', (err: any) => logError('backend', { message: err?.message || String(err), context: 'unhandledRejection', stack: err?.stack }));

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.enableCors({ origin: UI_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-IDE-Token'] });
  app.useBodyParser('json', { limit: '20mb' });
  app.useGlobalFilters(new JsonErrorFilter());
  const express = app.getHttpAdapter().getInstance();
  installTokenAuth(express);
  await app.get(PluginHost).attach(express);
  await app.init();
  installWebSockets(app.getHttpServer(), app.get(ProjectsService), app.get(PluginHost));
  await app.listen(PORT);
  console.log(`logic-ide listening on http://localhost:${PORT} for ${UI_ORIGINS.join(', ')}`);
}

bootstrap();
