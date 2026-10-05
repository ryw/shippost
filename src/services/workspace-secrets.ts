import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const SECRET_KEYS = ['ANTHROPIC_API_KEY', 'TYPEFULLY_API_KEY', 'TWITTER_CLIENT_SECRET', 'GRANOLA_API_KEY'] as const;
export type SecretKey = typeof SECRET_KEYS[number];
const injected = new Map<SecretKey, string>();

export function readWorkspaceSecrets(cwd: string): Partial<Record<SecretKey, string>> {
  const path = join(cwd, '.shippost-secrets.json');
  if (!existsSync(path)) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
  } catch { throw new Error('Cannot read local credentials. Restore the credentials file or check its permissions.'); }
  return Object.fromEntries(SECRET_KEYS.filter(key => typeof parsed[key] === 'string').map(key => [key, parsed[key]]));
}

export function secretSource(key: SecretKey): 'environment' | 'workspace' | undefined {
  if (!process.env[key]) return undefined;
  return injected.get(key) === process.env[key] ? 'workspace' : 'environment';
}

// Explicit environment settings win. Refresh only values this process injected.
export function loadWorkspaceSecrets(cwd: string): void {
  const secrets = readWorkspaceSecrets(cwd);
  for (const key of SECRET_KEYS) {
    if (secretSource(key) === 'environment') continue;
    if (secrets[key]) {
      process.env[key] = secrets[key];
      injected.set(key, secrets[key]!);
    } else {
      if (injected.has(key)) delete process.env[key];
      injected.delete(key);
    }
  }
}
