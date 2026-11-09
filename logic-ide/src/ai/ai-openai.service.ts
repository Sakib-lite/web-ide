import { Injectable } from '@nestjs/common';
import { SettingsService, ResolvedAiConfig } from '../settings/settings.service';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiOpenaiService {
  constructor(private readonly settings: SettingsService) {}

  async stream(messages: ChatMessage[], res: any) {
    const cfg = await this.settings.aiConfig();
    if (!cfg.apiKey) {
      res.writeHead(200, SSE_HEADERS);
      res.write(sseEvent({ error: 'No API key set for the active AI provider. Add one in Settings → AI.' }));
      res.end();
      return;
    }
    const body: Record<string, unknown> = { model: cfg.model, messages, stream: true };
    if (cfg.thinking) body.thinking = { type: 'enabled' };
    let upstream: Response;
    try {
      upstream = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      res.writeHead(200, SSE_HEADERS);
      res.write(sseEvent({ error: `Could not reach ${cfg.baseUrl}: ${err.message}` }));
      res.end();
      return;
    }
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      let message = detail;
      try {
        message = JSON.parse(detail)?.error?.message || detail;
      } catch {}
      res.writeHead(200, SSE_HEADERS);
      res.write(sseEvent({ error: `AI provider error (${upstream.status}): ${message.slice(0, 500)}` }));
      res.end();
      return;
    }
    res.writeHead(200, SSE_HEADERS);
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() || '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta;
              if (delta?.reasoning_content) res.write(sseEvent({ think: delta.reasoning_content }));
              if (delta?.content) res.write(sseEvent({ delta: delta.content }));
            } catch {}
          }
        }
      }
    } catch (err: any) {
      res.write(sseEvent({ error: 'Stream interrupted: ' + err.message }));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

const sseEvent = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;
