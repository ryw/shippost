import { existsSync } from 'fs';
import { join } from 'path';

export function isT2pProject(cwd: string = process.cwd()): boolean {
  const requiredPaths = [
    join(cwd, 'input'),
    join(cwd, 'prompts'),
    join(cwd, 'prompts', 'style.md'),
    join(cwd, 'prompts', 'work.md'),
    join(cwd, '.t2prc.json'),
  ];

  return requiredPaths.every((path) => existsSync(path));
}

export function validateConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  if (!c.ollama || typeof c.ollama !== 'object') {
    return false;
  }

  const ollama = c.ollama as Record<string, unknown>;

  if (typeof ollama.host !== 'string' || typeof ollama.model !== 'string') {
    return false;
  }

  return true;
}
