import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config/paths';

export interface AiProvider {
  baseUrl: string;
  apiKey?: string;
  models: string[];
  activeModel?: string;
  thinking?: boolean;
}

export interface AiSettings {
  responseStyle?: 'short' | 'detailed' | 'custom';
  customStyle?: string;
  activeProvider?: string;
  providers: Record<string, AiProvider>;
}

export interface ResolvedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  thinking: boolean;
  styleInstruction: string;
}

export interface Settings {
  githubToken?: string;
  githubUser?: string;
  disabledPlugins?: string[];
  favoriteFolders?: string[];
  ai?: AiSettings;
}

const FILE = path.join(DATA_DIR, 'settings.json');

const PRESET_PROVIDERS: Record<string, AiProvider> = {
  glm: { baseUrl: 'https://api.z.ai/api/coding/paas/v4', models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'], activeModel: 'glm-4.6', thinking: false },
  claude: { baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], activeModel: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'], activeModel: 'gpt-4o' },
  custom: { baseUrl: '', models: [] },
};

const STYLE_INSTRUCTIONS: Record<string, string> = {
  short: 'Keep every response short and simple: plain language, tight bullets, no filler.',
  detailed: 'Give a detailed, well-structured explanation with headings and examples where useful.',
};

@Injectable()
export class SettingsService {
  private cache: Settings | null = null;

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    let s: Settings;
    try {
      s = JSON.parse(await fs.readFile(FILE, 'utf8'));
    } catch {
      s = {};
    }
    s.ai = this.withPresets(s);
    this.cache = s;
    return s;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next: Record<string, unknown> = { ...(await this.get()), ...patch };
    for (const key of Object.keys(next)) if (next[key] === null || next[key] === undefined || next[key] === '') delete next[key];
    this.cache = next as Settings;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.cache;
  }

  async token(): Promise<string | null> {
    return (await this.get()).githubToken || null;
  }

  async saveAi(patch: AiSettings): Promise<Settings> {
    const stored = await this.get();
    const merged = mergeAiSettings(stored.ai!, patch);
    return this.update({ ai: merged });
  }

  async aiConfig(): Promise<ResolvedAiConfig> {
    const ai = (await this.get()).ai!;
    const id = ai.activeProvider && ai.providers[ai.activeProvider] ? ai.activeProvider : 'glm';
    const p = ai.providers[id] || PRESET_PROVIDERS.glm;
    const style = ai.responseStyle || 'short';
    const styleInstruction = style === 'custom' ? ai.customStyle || '' : STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.short;
    return {
      baseUrl: p.baseUrl || 'https://api.z.ai/api/coding/paas/v4',
      apiKey: p.apiKey || '',
      model: p.activeModel && p.models.includes(p.activeModel) ? p.activeModel : p.models[0] || 'glm-4.6',
      thinking: !!p.thinking,
      styleInstruction,
    };
  }

  toPublic(s: Settings) {
    const ai = s.ai || this.withPresets(s);
    const providers: Record<string, AiProvider & { hasApiKey: boolean }> = {};
    for (const [id, p] of Object.entries(ai.providers)) {
      providers[id] = { ...p, apiKey: p.apiKey ? '*'.repeat(10) : '', hasApiKey: !!p.apiKey };
    }
    return {
      githubToken: s.githubToken ? '*'.repeat(10) : '',
      hasGithubToken: !!s.githubToken,
      githubUser: s.githubUser || null,
      ai: { responseStyle: ai.responseStyle || 'short', customStyle: ai.customStyle || '', activeProvider: ai.activeProvider || 'glm', providers },
    };
  }

  private withPresets(s: Settings): AiSettings {
    if (s.ai?.providers && Object.keys(s.ai.providers).length) return s.ai;
    const legacy = s as Record<string, any>;
    const providers = JSON.parse(JSON.stringify(PRESET_PROVIDERS)) as Record<string, AiProvider>;
    if (legacy.aiApiKey || legacy.aiBaseUrl || legacy.aiModel) {
      providers.glm.baseUrl = legacy.aiBaseUrl || providers.glm.baseUrl;
      providers.glm.apiKey = legacy.aiApiKey;
      if (legacy.aiModel) {
        providers.glm.models = [legacy.aiModel, ...providers.glm.models.filter((m) => m !== legacy.aiModel)];
        providers.glm.activeModel = legacy.aiModel;
      }
    }
    return { responseStyle: 'short', customStyle: '', activeProvider: 'glm', providers };
  }
}

function mergeAiSettings(stored: AiSettings, patch: AiSettings): AiSettings {
  const providers: Record<string, AiProvider> = {};
  for (const [id, p] of Object.entries(patch.providers || {})) {
    const old = stored.providers?.[id];
    const apiKey = typeof p.apiKey === 'string' && p.apiKey && !p.apiKey.includes('*') ? p.apiKey : old?.apiKey;
    providers[id] = { baseUrl: p.baseUrl || '', apiKey, models: (p.models || []).filter(Boolean), activeModel: p.activeModel, thinking: !!p.thinking };
  }
  return {
    responseStyle: patch.responseStyle || 'short',
    customStyle: patch.customStyle || '',
    activeProvider: patch.activeProvider && providers[patch.activeProvider] ? patch.activeProvider : Object.keys(providers)[0],
    providers,
  };
}
