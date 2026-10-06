import { assertBackupWriter, checkpointWorkspace } from './workspace-backup.js';
import { GrokAuth } from './grok-auth.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, lstatSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { ANTHROPIC_MODELS, ANTHROPIC_TEMPERATURE_PATTERN } from './anthropic-models.js';
import { FileSystemService } from './file-system.js';
import { DEFAULT_CONFIG, type T2pConfig } from '../types/config.js';
import { isShippostProject } from '../utils/validation.js';
import { SECRET_KEYS, loadWorkspaceSecrets, readWorkspaceSecrets, secretSource } from './workspace-secrets.js';

interface Field {
  key: string; label: string; group: string;
  type: 'text' | 'number' | 'checkbox' | 'select' | 'url';
  options?: string[]; min?: number; max?: number; integer?: boolean; required?: boolean;
  env?: string;
}
export const SETTINGS_FIELDS: Field[] = [
  { key: 'llm.provider', label: 'Provider', group: 'Generation', type: 'select', options: ['ollama', 'anthropic', 'grok'], required: true },
  { key: 'ollama.host', label: 'Server URL', group: 'Ollama', type: 'url', required: true },
  { key: 'ollama.model', label: 'Model', group: 'Ollama', type: 'text', required: true },
  { key: 'ollama.timeout', label: 'Request timeout (milliseconds)', group: 'Ollama', type: 'number', min: 1000, max: 3600000, integer: true },
  { key: 'grok.model', label: 'Model', group: 'Grok', type: 'text' },
  { key: 'grok.reasoningEffort', label: 'Reasoning effort', group: 'Grok', type: 'select', options: ['low', 'medium', 'high', 'xhigh'] },
  { key: 'anthropic.model', label: 'Model', group: 'Anthropic', type: 'text', required: true },
  { key: 'anthropic.maxTokens', label: 'Maximum output tokens', group: 'Anthropic', type: 'number', min: 1, max: 200000, integer: true },
  { key: 'generation.postsPerTranscript', label: 'Posts per transcript', group: 'Generation', type: 'number', min: 1, max: 100, integer: true },
  { key: 'generation.temperature', label: 'Temperature', group: 'Generation', type: 'number', min: 0, max: 1 },
  { key: 'generation.strategies.enabled', label: 'Use generation strategies', group: 'Strategies', type: 'checkbox' },
  { key: 'generation.strategies.autoSelect', label: 'Automatically select strategies', group: 'Strategies', type: 'checkbox' },
  { key: 'generation.strategies.diversityWeight', label: 'Strategy diversity', group: 'Strategies', type: 'number', min: 0, max: 1 },
  { key: 'generation.strategies.preferThreadFriendly', label: 'Prefer thread-friendly strategies', group: 'Strategies', type: 'checkbox' },
  { key: 'typefully.socialSetId', label: 'Social set ID', group: 'Typefully', type: 'text', env: 'TYPEFULLY_SOCIAL_SET_ID' },
  { key: 'x.enabled', label: 'Enable X API access', group: 'X', type: 'checkbox' },
  { key: 'x.clientId', label: 'Client ID', group: 'X', type: 'text', env: 'SHIPPOST_X_CLIENT_ID' },
  { key: 'x.apiTier', label: 'API tier', group: 'X', type: 'select', options: ['free', 'basic'], env: 'SHIPPOST_X_API_TIER' },
  { key: 'blog.pullRequests.enabled', label: 'Open one PR per meeting (new posts + revisions)', group: 'Blog', type: 'checkbox' },
  { key: 'blog.pullRequests.repository', label: 'GitHub repository', group: 'Blog', type: 'text' },
  { key: 'blog.pullRequests.baseBranch', label: 'Target branch', group: 'Blog', type: 'text' },
  { key: 'blog.outputDir', label: 'Draft output directory', group: 'Blog', type: 'text' },
  { key: 'blog.imageDir', label: 'Image output directory', group: 'Blog', type: 'text' },
  { key: 'blog.imagePathPrefix', label: 'Public image URL prefix', group: 'Blog', type: 'text' },
];
const SECRET_LABELS = { ANTHROPIC_API_KEY: 'Anthropic API key', TYPEFULLY_API_KEY: 'Typefully API key', TWITTER_CLIENT_SECRET: 'X client secret', GRANOLA_API_KEY: 'Granola API key' };
function get(object: any, key: string): unknown { return key.split('.').reduce((value, part) => value?.[part], object); }
function set(object: any, key: string, value: unknown): void {
  const parts = key.split('.');
  let parent = object;
  for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
  if (value === undefined) delete parent[parts.at(-1)!];
  else parent[parts.at(-1)!] = value;
}
function rawConfig(cwd: string): T2pConfig {
  const path = join(cwd, '.shippostrc.json');
  try {
    const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(DEFAULT_CONFIG);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
    return config;
  } catch { throw new Error('Cannot read workspace settings. Restore the config file or check its permissions.'); }
}
function atomicWrite(path: string, content: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Settings files must not be symlinks');
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function getSettings(cwd: string) {
  loadWorkspaceSecrets(cwd);
  const raw = rawConfig(cwd);
  const config = existsSync(join(cwd, '.shippostrc.json')) ? new FileSystemService(cwd).loadConfig() : DEFAULT_CONFIG;
  const defaults: Record<string, unknown> = { 'grok.model': 'grok-4.7', 'grok.reasoningEffort': 'high', 'x.enabled': true, 'x.apiTier': 'free', 'typefully.socialSetId': '1', 'blog.pullRequests.enabled': false, 'blog.pullRequests.repository': 'ryw/rywalker.com', 'blog.pullRequests.baseBranch': 'main', 'blog.outputDir': 'src/content/drafts', 'blog.imageDir': 'public/images/posts', 'blog.imagePathPrefix': '/images/posts' };
  return {
    initialized: isShippostProject(cwd),
    grokConnected: new GrokAuth(cwd).connected(),
    anthropicModels: ANTHROPIC_MODELS,
    anthropicTemperaturePattern: ANTHROPIC_TEMPERATURE_PATTERN.source,
    fields: SETTINGS_FIELDS.map(field => ({ ...field, value: get(config, field.key) ?? defaults[field.key] ?? '', environment: field.env && process.env[field.env] ? field.env : undefined })),
    secrets: SECRET_KEYS.map(key => ({ key, label: SECRET_LABELS[key], configured: !!process.env[key] || (key === 'ANTHROPIC_API_KEY' && !!raw.anthropic?.apiKey), source: secretSource(key) || (key === 'ANTHROPIC_API_KEY' && raw.anthropic?.apiKey ? 'legacy config' : undefined) })),
  };
}

export function saveSettings(cwd: string, body: Record<string, unknown>): void {
  assertBackupWriter(cwd);
  const values = body.values;
  const secrets = body.secrets ?? {};
  if (!values || typeof values !== 'object' || Array.isArray(values) || !secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('Invalid settings payload');
  const config = rawConfig(cwd);
  // Fill provider defaults without replacing existing workspace-specific settings.
  config.llm ||= structuredClone(DEFAULT_CONFIG.llm);
  config.ollama = { ...DEFAULT_CONFIG.ollama!, ...config.ollama };
  config.anthropic = { ...DEFAULT_CONFIG.anthropic!, ...config.anthropic };
  config.generation ||= structuredClone(DEFAULT_CONFIG.generation);
  for (const [key, input] of Object.entries(values)) {
    const field = SETTINGS_FIELDS.find(field => field.key === key);
    if (!field) throw new Error('Unknown setting');
    if (field.env && process.env[field.env]) continue;
    let value = input;
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') throw new Error(`${field.label} must be on or off`);
    } else if (field.type === 'number') {
      if (value === '') value = undefined;
      else if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min! || value > field.max! || (field.integer && !Number.isInteger(value))) throw new Error(`${field.label} must be between ${field.min} and ${field.max}`);
    } else {
      if (typeof value !== 'string') throw new Error(`${field.label} must be text`);
      value = value.trim();
      if ((value as string).length > 2048) throw new Error(`${field.label} is too long`);
      if (!value && !field.required) value = undefined;
      if (field.required && !value) throw new Error(`${field.label} is required`);
      if (field.options && value !== undefined && !field.options.includes(value as string)) throw new Error(`Invalid ${field.label}`);
      if (field.type === 'url') {
        let url: URL;
        try { url = new URL(value as string); } catch { throw new Error('Server URL must be an HTTP or HTTPS URL'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Server URL must use HTTP or HTTPS without embedded credentials');
      }
      if (key === 'typefully.socialSetId' && value && !/^[A-Za-z0-9_-]+$/.test(value as string)) throw new Error('Invalid social set ID');
    }
    set(config, key, value);
  }
  const savedSecrets = readWorkspaceSecrets(cwd);
  if (config.anthropic?.apiKey && !savedSecrets.ANTHROPIC_API_KEY) savedSecrets.ANTHROPIC_API_KEY = config.anthropic.apiKey;
  delete config.anthropic?.apiKey;
  for (const [key, value] of Object.entries(secrets)) {
    if (!SECRET_KEYS.includes(key as any)) throw new Error('Unknown credential');
    const secretKey = key as typeof SECRET_KEYS[number];
    if (secretSource(secretKey) === 'environment') throw new Error('This credential is managed by the environment');
    if (value === null) delete savedSecrets[secretKey];
    else {
      if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\r\n]/.test(value)) throw new Error('Invalid credential value');
      if (secretKey === 'ANTHROPIC_API_KEY' && !value.startsWith('sk-ant-')) throw new Error('Anthropic keys must start with sk-ant-');
      savedSecrets[secretKey] = value.trim();
    }
  }
  // Only POST/save creates missing workspace files. Never replace editorial content.
  mkdirSync(join(cwd, 'input'), { recursive: true });
  mkdirSync(join(cwd, 'prompts'), { recursive: true });
  const templates = join(dirname(fileURLToPath(import.meta.url)), '../templates');
  for (const name of readdirSync(templates).filter(name => name.endsWith('.md'))) {
    const path = join(cwd, 'prompts', name);
    if (!existsSync(path)) writeFileSync(path, readFileSync(join(templates, name)), { flag: 'wx' });
  }
  for (const [name, content] of [['posts.jsonl', ''], ['strategies.json', readFileSync(join(templates, 'strategies.json'), 'utf8')]]) {
    if (!existsSync(join(cwd, name))) writeFileSync(join(cwd, name), content, { flag: 'wx' });
  }
  const ignorePath = join(cwd, '.gitignore');
  let ignore = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  for (const rule of ['input/', '.shippost-blog-prs.lock/', '.shippost-grok/', '.shippostrc.json', '.shippost-secrets.json', '.shippost-*.json', '.granola-*.json', '.shippost-revisions/', '.env', '.env.local']) {
    if (!ignore.split(/\r?\n/).includes(rule)) ignore += '\n' + rule + '\n';
  }
  atomicWrite(ignorePath, ignore);
  atomicWrite(join(cwd, '.shippost-secrets.json'), JSON.stringify(savedSecrets, null, 2) + '\n');
  atomicWrite(join(cwd, '.shippostrc.json'), JSON.stringify(config, null, 2) + '\n');
  loadWorkspaceSecrets(cwd);
  checkpointWorkspace(cwd);
}
