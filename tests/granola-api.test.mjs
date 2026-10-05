import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GranolaAPI, syncGranolaAPI } from '../dist/services/granola-api.js';
import { saveSettings, getSettings } from '../dist/services/settings.js';
import { loadWorkspaceSecrets } from '../dist/services/workspace-secrets.js';

const today = new Date().toISOString();
const first = { id: 'not_123456789abcde', title: 'Same title', created_at: today };
const second = { ...first, id: 'not_abcdefghijklm1' };
const json = value => new Response(JSON.stringify(value));

test('Granola key can be saved, retained, redacted, and removed through settings', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'granola-settings-'));
  const previous = process.env.GRANOLA_API_KEY;
  delete process.env.GRANOLA_API_KEY;
  try {
    saveSettings(cwd, { values: {}, secrets: { GRANOLA_API_KEY: 'synthetic-granola' } });
    assert.equal(process.env.GRANOLA_API_KEY, 'synthetic-granola');
    assert.equal(getSettings(cwd).secrets.find(s => s.key === 'GRANOLA_API_KEY').configured, true);
    assert.equal(JSON.stringify(getSettings(cwd)).includes('synthetic-granola'), false);
    saveSettings(cwd, { values: {}, secrets: {} });
    assert.equal(process.env.GRANOLA_API_KEY, 'synthetic-granola');
    saveSettings(cwd, { values: {}, secrets: { GRANOLA_API_KEY: null } });
    assert.equal(process.env.GRANOLA_API_KEY, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true }); loadWorkspaceSecrets(cwd);
    if (previous !== undefined) process.env.GRANOLA_API_KEY = previous;
  }
});

test('official API paginates with date filters and safe authentication errors', async () => {
  const urls = [];
  const api = new GranolaAPI('synthetic-key', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(options.redirect, 'error');
    urls.push(new URL(url));
    return urls.length === 1 ? json({ notes: [first, { ...first, created_at: '2020-01-01' }], hasMore: true, cursor: 'next' }) : json({ notes: [second], hasMore: false });
  });
  const notes = [];
  for await (const note of api.recentNotes()) notes.push(note);
  assert.equal(notes.length, 2);
  assert.ok(urls[0].searchParams.get('created_after'));
  assert.equal(urls[1].searchParams.get('cursor'), 'next');
  assert.equal(urls[0].origin, 'https://public-api.granola.ai');
  const denied = new GranolaAPI('secret', async () => new Response('secret must never be reflected', { status: 401 }));
  await assert.rejects(() => denied.content(first.id), /rejected the saved API key/);
});

test('notes import preserves distinct IDs, checkpoints, and retries empty notes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'granola-import-'));
  let allowSecond = false;
  let detailCalls = [];
  const client = {
    async *recentNotes() { yield first; yield second; },
    async content(id) {
      detailCalls.push(id);
      return { note: { ...first, id, summary_text: 'Summary', attendees: [{ name: 'Alex' }] }, content: id === second.id && !allowSecond ? '' : 'Meeting notes' };
    },
  };
  try {
    await syncGranolaAPI(cwd, 'synthetic', () => {}, {}, client);
    assert.equal(readdirSync(join(cwd, 'input')).length, 1);
    assert.equal(Object.keys(JSON.parse(readFileSync(join(cwd, '.granola-sync-state.json'))).syncedDocuments).length, 1);
    allowSecond = true; detailCalls = [];
    await syncGranolaAPI(cwd, 'synthetic', () => {}, {}, client);
    assert.deepEqual(detailCalls, [second.id]);
    assert.equal(readdirSync(join(cwd, 'input')).length, 2);
    const meta = JSON.parse(readFileSync(join(cwd, '.shippost-transcript-meta.json')));
    assert.equal(Object.values(meta)[0].sourceType, 'granola-notes');
    assert.deepEqual(Object.values(meta)[0].attendees, ['Alex']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
