import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** Local completed usage only: never infer a subscription allowance from tokens. */
export function grokUsage(cwd: string) {
  let tokens = 0, calls = 0, updatedAt: string | null = null;
  const root = join(cwd, '.shippost-grok', 'sessions');
  const directories = (path: string) => {
    try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
    catch { return []; }
  };
  for (const workspace of directories(root)) for (const session of directories(join(root, workspace))) {
    try {
      const data = JSON.parse(readFileSync(join(root, workspace, session, 'usage.json'), 'utf8'));
      const count = data.session?.totalTokens;
      if (!Number.isFinite(count) || count < 0) continue;
      tokens += count;
      if (Number.isFinite(data.session.modelCalls) && data.session.modelCalls >= 0) calls += data.session.modelCalls;
      if (typeof data.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt)) && (!updatedAt || data.updatedAt > updatedAt)) updatedAt = data.updatedAt;
    } catch { /* Native CLI may be updating a file; try again on the next refresh. */ }
  }
  return { tokens, calls, updatedAt, remainingPercent: null, resetsAt: null };
}
