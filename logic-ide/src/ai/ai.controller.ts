import { Body, Controller, Post } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';
import { fail } from '../common/errors';

@Controller('api/ai')
export class AiController {
  constructor(private readonly projects: ProjectsService) {}

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
