import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ASKPASS } from '../config/paths';

const run = promisify(execFile);

export interface CommandEntry {
  cmd: string;
  output: string;
  ok: boolean;
  ms: number;
  at: number;
}

export interface ExecOptions {
  log?: boolean;
  net?: boolean;
  timeout?: number;
}

const TOKEN_FLAGS = ['-c', 'credential.helper=', '-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'url.https://github.com/.insteadOf=ssh://git@github.com/'];

export function buildEnv(token: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_EDITOR: 'true' };
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  if (token) Object.assign(env, { GIT_ASKPASS: ASKPASS, GIT_TOKEN: token, SSH_ASKPASS_REQUIRE: 'never' });
  return env;
}

export class GitRunner {
  constructor(
    private readonly cwd: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly onCommand: (entry: CommandEntry) => void,
  ) {}

  async exec(args: string[], { log = false, net = false, timeout }: ExecOptions = {}): Promise<string> {
    const started = Date.now();
    const token = await this.getToken();
    const full = net && token ? [...TOKEN_FLAGS, ...args] : args;
    const record = (output: string, ok: boolean) => log && this.onCommand({ cmd: 'git ' + args.join(' '), output, ok, ms: Date.now() - started, at: Date.now() });
    try {
      const { stdout, stderr } = await run('git', full, { cwd: this.cwd, env: buildEnv(token), maxBuffer: 100 * 1024 * 1024, timeout: timeout ?? (net ? 180_000 : 60_000), killSignal: 'SIGKILL' });
      record((stdout + (stderr ? '\n' + stderr : '')).trim(), true);
      return stdout;
    } catch (err: any) {
      let message = String(err.stderr || err.stdout || err.message || '').trim();
      if (err.killed || err.signal === 'SIGKILL') message = `git ${args[0]} timed out: the remote did not answer or git waited for credentials. ${message}`.trim();
      record(message, false);
      const e: any = new Error(message.split('\n').filter((l) => l && !l.startsWith('hint:')).slice(0, 6).join('\n') || 'git failed');
      e.status = 400;
      e.raw = message;
      throw e;
    }
  }

  static clone(url: string, dest: string, token: string | null, onOutput?: (chunk: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...(token ? TOKEN_FLAGS : []), 'clone', '--progress', url, dest], { env: buildEnv(token) });
      let output = '';
      const onData = (d: Buffer) => {
        output += d.toString();
        onOutput?.(d.toString());
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', reject);
      const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(output);
        else reject(Object.assign(new Error(output.trim().split('\n').pop() || 'git clone failed'), { status: 400, output }));
      });
    });
  }
}
