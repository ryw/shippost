import { assertBackupWriter, checkpointWorkspace } from './workspace-backup.js';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isGenerationTarget, type GenerationTarget } from '../types/state.js';

export interface GenerationItem { file: string; target: GenerationTarget; pid?: number }
export interface GenerationSnapshot { version: 1; queue: GenerationItem[]; active: GenerationItem | null }
const filename = '.shippost-generation-queue.json';
function valid(item: any): item is GenerationItem {
  return item && typeof item.file === 'string' && item.file.length > 0 && item.file !== '.' && item.file !== '..' && basename(item.file) === item.file && !/[\\/\r\n\0]/.test(item.file) && isGenerationTarget(item.target) && (item.pid === undefined || (Number.isSafeInteger(item.pid) && item.pid > 0));
}
export function loadGenerationQueue(cwd: string): GenerationSnapshot {
  const path = join(cwd, filename);
  if (!existsSync(path)) return { version: 1, queue: [], active: null };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.queue) || !data.queue.every(valid) || (data.active !== null && !valid(data.active))) throw new Error('Invalid saved generation queue; preserve the file and restore it before starting generation');
  return data;
}
export function saveGenerationQueue(cwd: string, queue: GenerationItem[], active: GenerationItem | null) {
  assertBackupWriter(cwd);
  const path = join(cwd, filename), temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, queue, active }) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
    checkpointWorkspace(cwd);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function recoverGenerationQueue(snapshot: GenerationSnapshot): GenerationItem[] {
  const seen = new Set<string>();
  return [...(snapshot.active ? [snapshot.active] : []), ...snapshot.queue].filter(item => {
    const key = JSON.stringify([item.file, item.target]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
/** A killed UI may leave its worker alive. Wait for that exact worker, not an unrelated reused PID. */
export function generationWorkerAlive(item: GenerationItem): boolean {
  if (!item.pid) return false;
  try {
    const args = execFileSync('ps', ['-p', String(item.pid), '-o', 'args='], { encoding: 'utf8' });
    return args.includes('work --all --files ' + item.file + ' --target ' + item.target);
  } catch { return false; }
}
