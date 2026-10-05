import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { inLast30Days, transcriptDate } from '../utils/transcript-date.js';

interface Note {
  id: string; title: string | null; created_at: string; web_url?: string;
  summary_text?: string; summary_markdown?: string | null;
  private_notes_text?: string | null; private_notes_markdown?: string | null;
  attendees?: { name?: string; email?: string }[];
}

export class GranolaAPI {
  constructor(private key: string, private request: typeof fetch = fetch) {}

  private async get(path: string): Promise<any> {
    if (!this.key) throw new Error('Save your Granola API key in Settings → Credentials first.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request('https://public-api.granola.ai' + path, {
        headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
      });
      if (response.ok) return response.json();
      if (response.status === 429 && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after') || 1);
        await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, seconds || 1)) * 1000));
        continue;
      }
      if (response.status === 401) throw new Error('Granola rejected the saved API key. Replace it in Settings → Credentials.');
      if (response.status === 403) throw new Error('Granola access denied. Check your API key’s Personal notes scope and Business or Enterprise plan.');
      throw new Error(`Granola API request failed (HTTP ${response.status}). Try syncing again.`);
    }
    throw new Error('Granola rate limit reached. Try syncing again shortly.');
  }

  async *recentNotes(now = new Date()): AsyncGenerator<Note> {
    const start = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - 29);
    // API uses strictly-after semantics. Include the first midnight as well.
    const after = new Date(start.getTime() - 1).toISOString();
    const params = new URLSearchParams({ created_after: after, created_before: now.toISOString(), page_size: '30' });
    const seen = new Set<string>();
    while (true) {
      const page = await this.get('/v1/notes?' + params);
      if (!Array.isArray(page.notes)) throw new Error('Granola returned an invalid notes response.');
      for (const note of page.notes) {
        if (!/^not_[a-zA-Z0-9]{14}$/.test(note.id)) throw new Error('Granola returned an invalid note ID.');
        if (inLast30Days(transcriptDate('', note.created_at), now)) yield note;
      }
      if (!page.hasMore) break;
      if (!page.cursor || seen.has(page.cursor)) throw new Error('Granola returned an invalid pagination cursor.');
      seen.add(page.cursor); params.set('cursor', page.cursor);
    }
  }

  async content(id: string): Promise<{ note: Note; content: string }> {
    const note: Note = await this.get('/v1/notes/' + encodeURIComponent(id));
    const sections = [note.private_notes_markdown || note.private_notes_text, note.summary_markdown || note.summary_text].filter(Boolean);
    // Import meeting notes; these remain useful even when transcript access is disabled.
    return { note, content: sections.join('\n\n') };
  }
}

function readJSON(path: string, fallback: any): any {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}
function writeJSON(path: string, value: unknown): void {
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, path);
}

export async function syncGranolaAPI(cwd: string, key: string, log: (line: string) => void, options: { count?: number; force?: boolean } = {}, client = new GranolaAPI(key)): Promise<void> {
  const input = join(cwd, 'input');
  mkdirSync(input, { recursive: true });
  const statePath = join(cwd, '.granola-sync-state.json');
  const metaPath = join(cwd, '.shippost-transcript-meta.json');
  const state = readJSON(statePath, { syncedDocuments: {} });
  let imported = 0, empty = 0, failed = 0;
  const seen = new Set<string>();
  for await (const summary of client.recentNotes()) {
    if (seen.has(summary.id)) continue;
    seen.add(summary.id);
    const previous = state.syncedDocuments[summary.id];
    if (!options.force && previous?.filename && existsSync(join(input, previous.filename))) continue;
    try {
      const { note, content } = await client.content(summary.id);
      if (!content.trim()) { empty++; continue; }
      const date = transcriptDate('', summary.created_at)!;
      const filename = `${date}_${summary.id}.md`;
      const path = join(input, filename);
      // Existing untracked source content is never silently replaced.
      const output = `# ${note.title || summary.title || 'Untitled meeting'}\n\n${content}\n`;
      if (existsSync(path) && readFileSync(path, 'utf8') !== output && !options.force) {
        throw new Error('Existing source differs; use --force to replace it explicitly.');
      }
      writeFileSync(path, output, { mode: 0o600 });
      const meta = readJSON(metaPath, {});
      meta[filename] = { ...meta[filename], meetingDate: date, granolaId: summary.id, sourceUrl: note.web_url,
        sourceType: 'granola-notes', attendees: (note.attendees || []).map(a => a.name || a.email).filter(Boolean),
        summary: note.summary_text || note.summary_markdown || 'Imported Granola meeting notes.' };
      writeJSON(metaPath, meta);
      state.syncedDocuments[summary.id] = { syncedAt: new Date().toISOString(), filename };
      writeJSON(statePath, state);
      imported++;
      log(`Imported ${imported} meeting notes`);
      if (options.count && imported >= options.count) break;
    } catch (error) {
      failed++;
      log((error as Error).message);
    }
    // Stay below the documented sustained limit of five requests per second.
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  log(`Imported ${imported} meetings from the past 30 days. ${empty} empty notes left for retry.`);
  if (failed) throw new Error(`${failed} Granola notes could not be imported. Successful imports were saved; sync again to retry.`);
}
