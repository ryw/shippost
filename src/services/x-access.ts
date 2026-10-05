import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Shared gate for OAuth and API clients, including CLI commands. */
export function assertXEnabled(cwd = process.cwd()): void {
  for (const directory of new Set([process.cwd(), cwd])) {
    const path = join(directory, '.shippostrc.json');
    if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).x?.enabled === false) {
      throw new Error('X API access is disabled. Enable it in Settings → X when you want to resume.');
    }
  }
}
