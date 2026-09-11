import { Body, Controller, Post } from '@nestjs/common';
import { logError } from '../common/error-log';

@Controller('api/logs')
export class LogsController {
  @Post('frontend-error')
  async frontendError(@Body() body: { message?: string; url?: string; stack?: string }) {
    await logError('frontend', { message: body.message || 'Unknown error', context: body.url, stack: body.stack });
    return { ok: true };
  }
}
