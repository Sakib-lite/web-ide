import { Body, Controller, Post, Res } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { Response } from 'express';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';
import { fail } from '../common/errors';
import { AiOpenaiService, ChatMessage } from './ai-openai.service';
import { SettingsService } from '../settings/settings.service';

@Controller('api/ai')
export class AiController {
  constructor(private readonly projects: ProjectsService, private readonly openai: AiOpenaiService, private readonly settings: SettingsService) {}

  @Post('commit-message')
  async commitMessage(@Root() root: string, @Body() body: { paths: string[]; model?: string }) {
    const p = this.projects.require(root);
    const paths = body.paths || [];
    if (!paths.length) fail('Select at least one changed file');
    let diff = await p.git.patch(paths);
    if (!diff.trim()) fail('No diff for the selected files');
    if (diff.length > 60000) diff = diff.slice(0, 60000) + '\n…(diff truncated)';
    const recent = await p.git.exec(['log', '-n5', '--pretty=format:%s']).catch(() => '');
    const prompt = `Write a git commit message for the diff below. Follow the style of these recent commits from this repository:\n${recent}\n\nRules: first line is a concise summary (max 72 chars, conventional-commit style if the repo uses it), then an optional blank line and a short body with bullet points only when it adds information. Output ONLY the commit message, no quotes, no markdown fences.\n\n${diff}`;
    const text = await runClaude(prompt, p.root, body.model || 'haiku');
    return { message: text.replace(/^```[a-z]*\n?|```$/g, '').trim() };
  }

  @Post('analyze')
  async analyze(
    @Root() root: string,
    @Res() res: Response,
    @Body() body: { path?: string; content?: string; selection?: string; selectionStartLine?: number; selectionEndLine?: number; language?: string },
  ) {
    if (!body.content?.trim()) fail('No file content to analyze');
    const start = body.selectionStartLine || 1;
    const end = body.selectionEndLine || start + (body.selection ? body.selection.split('\n').length - 1 : 0);
    const numbered = body.content
      .split('\n')
      .map((line, i) => {
        const n = i + 1;
        return n === start ? `>>> BEGIN SELECTION (line ${n})\n${n}| ${line}` : n === end ? `${n}| ${line}\n<<< END SELECTION` : `${n}| ${line}`;
      })
      .join('\n');
    const hasSelection = !!body.selection?.trim();
    const base = hasSelection
      ? 'You are a senior code analyst inside an IDE. The user shares one whole file with a marked selection. Explain ONLY what the selected part does, using the rest of the file as context. Then add a short "Additional notes" section with genuinely useful observations (edge cases, bugs, improvements). Use concise markdown with code spans where helpful. Do not restate the whole file.'
      : 'You are a senior code analyst inside an IDE. The user shares one whole file. Explain what this file does: its purpose, main components and how they interact. Then add a short "Additional notes" section with genuinely useful observations (edge cases, bugs, improvements). Use concise markdown with code spans where helpful.';
    const user = hasSelection
      ? `File: ${body.path || '(untitled)'}${body.language ? ` (${body.language})` : ''}\nSelected lines: ${start}-${end}\n\n${numbered}`
      : `File: ${body.path || '(untitled)'}${body.language ? ` (${body.language})` : ''}\n\n${numbered}`;
    await this.openai.stream([{ role: 'system', content: await this.system(base) }, { role: 'user', content: user }], res);
  }

  @Post('chat')
  async chat(@Res() res: Response, @Body() body: { messages?: ChatMessage[] }) {
    const messages = (body.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
    if (!messages.length) fail('No messages to send');
    const base = 'You are a helpful coding assistant inside an IDE, discussing code the user selected and analyzed. Be concise and precise; use markdown.';
    await this.openai.stream([{ role: 'system', content: await this.system(base) }, ...messages], res);
  }

  @Post('diff')
  async diff(@Res() res: Response, @Body() body: { path?: string; language?: string; before?: string; after?: string; scope?: 'hunk' | 'file' }) {
    const before = body.before ?? '';
    const after = body.after ?? '';
    if (before === after) fail('No difference between the versions');
    const clip = (t: string) => (t.length > 40000 ? t.slice(0, 40000) + '\n…(truncated)' : t || '(empty)');
    const lang = body.language || '';
    const base =
      'You explain code changes in an IDE. Given BEFORE (old version) and AFTER (current version), answer in exactly this compact markdown format:\n\n**Before:** <what the old code did, 1-2 lines>\n\n**Current:** <what the new code does, 1-2 lines>\n\n**Changed:** <the essence of the change and why, 1-3 lines>\n\nQuote only small key code spans, never whole blocks. If BEFORE or AFTER is empty, say "new file" or "deleted code" accordingly.';
    const user = `File: ${body.path || '(untitled)'}${body.language ? ` (${lang})` : ''} — ${body.scope === 'hunk' ? 'one changed region' : 'all changes in this file'}\n\nBEFORE:\n\`\`\`${lang}\n${clip(before)}\n\`\`\`\n\nAFTER:\n\`\`\`${lang}\n${clip(after)}\n\`\`\``;
    await this.openai.stream([{ role: 'system', content: await this.system(base) }, { role: 'user', content: user }], res);
  }

  private async system(base: string): Promise<string> {
    const style = (await this.settings.aiConfig()).styleInstruction;
    return style ? `${base}\n\nResponse style: ${style}` : base;
  }
}

function runClaude(prompt: string, cwd: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--no-session-persistence', '--model', model, '--output-format', 'text'], { cwd, env: process.env });
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e: any) => reject(new Error(e.code === 'ENOENT' ? 'The claude CLI is not installed' : e.message)));
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Timed out generating the message'));
    }, 120000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude exited with ${code}`));
    });
    proc.stdin.end(prompt);
  });
}
