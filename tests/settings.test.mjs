import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { getSettings, saveSettings } from '../dist/services/settings.js';
import { loadWorkspaceSecrets } from '../dist/services/workspace-secrets.js';

function fixture() { return mkdtempSync(join(tmpdir(), 'shippost-settings-')); }
const configuredValues = { 'llm.provider': 'ollama', 'ollama.model': 'fixture-model', 'generation.temperature': 0, 'generation.strategies.diversityWeight': 0 };

test('first-run setup is non-destructive and stores/redacts credentials', () => {
  const cwd = fixture();
  try {
    mkdirSync(join(cwd, 'prompts'));
    writeFileSync(join(cwd, 'prompts/style.md'), 'My existing style');
    writeFileSync(join(cwd, 'posts.jsonl'), 'existing posts');
    writeFileSync(join(cwd, 'strategies.json'), '[]');
    assert.equal(getSettings(cwd).initialized, false);
    assert.equal(existsSync(join(cwd, '.shippostrc.json')), false);
    saveSettings(cwd, { values: configuredValues, secrets: { TYPEFULLY_API_KEY: 'synthetic-private-value' } });
    assert.equal(getSettings(cwd).initialized, true);
    assert.equal(readFileSync(join(cwd, 'prompts/style.md'), 'utf8'), 'My existing style');
    assert.equal(readFileSync(join(cwd, 'posts.jsonl'), 'utf8'), 'existing posts');
    assert.equal(readFileSync(join(cwd, 'strategies.json'), 'utf8'), '[]');
    assert.ok(existsSync(join(cwd, 'prompts/blog-revision.md')));
    assert.equal(statSync(join(cwd, '.shippost-secrets.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(cwd, '.shippostrc.json')).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(getSettings(cwd)).includes('synthetic-private-value'), false);
    assert.equal(readFileSync(join(cwd, '.shippostrc.json'), 'utf8').includes('synthetic-private-value'), false);
    assert.ok(readFileSync(join(cwd, '.gitignore'), 'utf8').includes('.shippost-secrets.json'));
    saveSettings(cwd, { values: { 'ollama.model': 'changed-model' }, secrets: {} });
    assert.equal(process.env.TYPEFULLY_API_KEY, 'synthetic-private-value');
    const moduleUrl = new URL('../dist/services/file-system.js', import.meta.url).href;
    const env = { ...process.env }; delete env.TYPEFULLY_API_KEY;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', `import { FileSystemService } from ${JSON.stringify(moduleUrl)}; new FileSystemService().loadConfig(); process.stdout.write(process.env.TYPEFULLY_API_KEY === 'synthetic-private-value' ? 'loaded' : 'missing');`], { cwd, env, encoding: 'utf8' }), 'loaded');
    saveSettings(cwd, { values: {}, secrets: { TYPEFULLY_API_KEY: null } });
    assert.equal(getSettings(cwd).secrets.find(s => s.key === 'TYPEFULLY_API_KEY').configured, false);
    assert.equal(process.env.TYPEFULLY_API_KEY, undefined);
  } finally { rmSync(cwd, { recursive: true, force: true }); loadWorkspaceSecrets(cwd); }
});

test('validation rejects invalid values before writing and preserves environment precedence', () => {
  const cwd = fixture();
  const before = process.env.SHIPPOST_X_CLIENT_ID;
  const oldKey = process.env.TYPEFULLY_API_KEY;
  try {
    for (const values of [{ 'generation.temperature': -1 }, { 'llm.provider': 'bad' }, { 'generation.postsPerTranscript': 1.5 }, { '__proto__.polluted': 'yes' }, { 'ollama.host': 'file:///tmp' }]) {
      assert.throws(() => saveSettings(cwd, { values }));
      assert.equal(existsSync(join(cwd, '.shippostrc.json')), false);
    }
    process.env.SHIPPOST_X_CLIENT_ID = 'external-client';
    process.env.TYPEFULLY_API_KEY = 'external-key';
    saveSettings(cwd, { values: { ...configuredValues, 'x.clientId': 'ignored-client' } });
    const data = getSettings(cwd);
    assert.equal(data.fields.find(f => f.key === 'x.clientId').value, 'external-client');
    assert.equal(data.secrets.find(s => s.key === 'TYPEFULLY_API_KEY').source, 'environment');
    assert.throws(() => saveSettings(cwd, { values: {}, secrets: { TYPEFULLY_API_KEY: null } }), /environment/);
    assert.equal(readFileSync(join(cwd, '.shippostrc.json'), 'utf8').includes('external-client'), false);
    assert.equal(readFileSync(join(cwd, '.shippost-secrets.json'), 'utf8').includes('external-key'), false);
  } finally {
    if (before === undefined) delete process.env.SHIPPOST_X_CLIENT_ID; else process.env.SHIPPOST_X_CLIENT_ID = before;
    if (oldKey === undefined) delete process.env.TYPEFULLY_API_KEY; else process.env.TYPEFULLY_API_KEY = oldKey;
    rmSync(cwd, { recursive: true, force: true }); loadWorkspaceSecrets(cwd);
  }
});

test('migrates legacy config key without exposing it or overwriting unrelated settings', () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, '.shippostrc.json'), JSON.stringify({ llm: { provider: 'anthropic' }, anthropic: { model: 'legacy-model', apiKey: 'sk-ant-synthetic' }, custom: { preserved: true } }));
    assert.equal(JSON.stringify(getSettings(cwd)).includes('sk-ant-synthetic'), false);
    saveSettings(cwd, { values: { 'anthropic.model': 'new-model' } });
    const saved = JSON.parse(readFileSync(join(cwd, '.shippostrc.json'), 'utf8'));
    assert.equal(saved.anthropic.apiKey, undefined);
    assert.equal(saved.custom.preserved, true);
    assert.equal(JSON.parse(readFileSync(join(cwd, '.shippost-secrets.json'), 'utf8')).ANTHROPIC_API_KEY, 'sk-ant-synthetic');
  } finally { rmSync(cwd, { recursive: true, force: true }); loadWorkspaceSecrets(cwd); }
});

test('UI boots without config; settings writes require same-origin session token', async () => {
  const cwd = fixture();
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const ui = new URL('../dist/commands/ui/index.js', import.meta.url).href;
  const ollama = new URL('../dist/services/ollama.js', import.meta.url).href;
  const env = { ...process.env };
  for (const key of ['TYPEFULLY_API_KEY', 'ANTHROPIC_API_KEY', 'TWITTER_CLIENT_SECRET']) delete env[key];
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { uiCommand } from ${JSON.stringify(ui)}; import { OllamaService } from ${JSON.stringify(ollama)}; OllamaService.prototype.ensureAvailable = async () => {}; OllamaService.prototype.generate = async function() { return this.getModelName(); }; import { WorkspaceBackup } from ${JSON.stringify(new URL('../dist/services/workspace-backup.js', import.meta.url).href)};
    WorkspaceBackup.prototype.start=function(){};WorkspaceBackup.prototype.assertWriter=function(){};WorkspaceBackup.prototype.checkpoint=function(){};
    (await import('node:fs')).writeFileSync('.shippost-backup.json',JSON.stringify({repository:'test/private'}));
    await uiCommand({ port: ${port} });`], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timed out')), 10000);
      child.stdout.on('data', data => { if (data.toString().includes('ship ui running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('startup failed ' + code)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const html = await (await fetch(base)).text();
    const token = html.match(/'X-Settings-Token': '([^']+)'/)[1];
    assert.notEqual(token, '__SHIPPOST_SETTINGS_TOKEN__');
    const data = await (await fetch(base + '/api/settings')).json();
    assert.equal(data.initialized, false);
    assert.equal((await fetch(base + '/api/posts')).status, 409);
    const write = (headers, path = '/api/settings', body = { values: configuredValues, secrets: { TYPEFULLY_API_KEY: 'synthetic-key' } }) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await write({})).status, 403);
    assert.equal((await write({ 'X-Settings-Token': token, Origin: 'https://untrusted.example' })).status, 403);
    const saved = await write({ 'X-Settings-Token': token });
    assert.equal(saved.status, 200);
    const result = await saved.text();
    assert.equal(result.includes('synthetic-key'), false);
    assert.equal(JSON.parse(result).initialized, true);
    assert.equal((await fetch(base + '/api/posts')).status, 200);
    assert.equal((await write({ 'X-Settings-Token': token }, '/api/settings/test', {})).status, 200);
    const rewriteBody = { content: 'test content', start: 0, end: 4, instruction: 'rewrite' };
    assert.equal((await (await write({}, '/api/rewrite', rewriteBody)).json()).replacement, 'fixture-model');
    assert.equal((await write({ 'X-Settings-Token': token }, '/api/settings', { values: { 'ollama.model': 'changed-live' } })).status, 200);
    assert.equal((await (await write({}, '/api/rewrite', rewriteBody)).json()).replacement, 'changed-live');
    const invalidHostStatus = await new Promise((resolve, reject) => {
      const req = request(base, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await write({}, '/api/typefully/key', { key: 'fixture' })).status, 403);
    assert.equal((await write({ 'X-Settings-Token': token }, '/api/typefully/key', { key: '' })).status, 400);
    const keySaved = await write({ 'X-Settings-Token': token }, '/api/typefully/key', { key: 'fixture-typefully-key' });
    assert.equal(keySaved.status, 200);
    assert.ok(!JSON.stringify(await keySaved.json()).includes('fixture-typefully-key'));
    assert.equal((await write({}, '/api/grok/connect', {})).status, 403);
    assert.equal((await write({ 'X-Settings-Token': token, Origin: 'https://untrusted.example' }, '/api/grok/poll', {})).status, 403);
    const grokStatus = await write({ 'X-Settings-Token': token }, '/api/grok/poll', {});
    assert.deepEqual(await grokStatus.json(), { status: 'disconnected' });

  } finally {
    child.kill(); await once(child, 'exit'); rmSync(cwd, { recursive: true, force: true });
  }
});

test('malformed credential storage never echoes its contents in errors', () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, '.shippost-secrets.json'), 'synthetic-secret malformed');
    assert.throws(() => getSettings(cwd), error => !error.message.includes('synthetic-secret'));
  } finally { rmSync(cwd, { recursive: true, force: true }); loadWorkspaceSecrets(cwd); }
});
