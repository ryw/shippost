import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { FileSystemService } from '../dist/services/file-system.js';
import { DEFAULT_CONFIG } from '../dist/types/config.js';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'shippost-approval-'));
  mkdirSync(join(dir, 'input'));
  mkdirSync(join(dir, 'prompts'));
  for (const name of ['style', 'work']) writeFileSync(join(dir, 'prompts', name + '.md'), 'Test');
  writeFileSync(join(dir, '.shippostrc.json'), JSON.stringify(DEFAULT_CONFIG));
  return dir;
}

const post = (id, status = 'new') => ({ id, status, content: id, sourceFile: 'test.txt', platform: 'x', metadata: {}, timestamp: new Date().toISOString() });

test('environment overrides preserve defaults and do not persist to config', () => {
  const dir = workspace();
  const keys = ['SHIPPOST_X_CLIENT_ID', 'SHIPPOST_X_API_TIER', 'TYPEFULLY_SOCIAL_SET_ID'];
  const before = keys.map(key => process.env[key]);
  try {
    const path = join(dir, '.shippostrc.json');
    writeFileSync(path, JSON.stringify({ llm: { provider: 'anthropic' }, anthropic: { model: 'test' }, generation: { strategies: { enabled: false } }, x: { apiTier: 'free' }, typefully: { socialSetId: 'old' } }));
    const original = readFileSync(path, 'utf8');
    keys.forEach((key, i) => process.env[key] = ['client-test', 'basic', '42'][i]);
    const config = new FileSystemService(dir).loadConfig();
    assert.deepEqual(config.x, { clientId: 'client-test', apiTier: 'basic' });
    assert.equal(config.typefully.socialSetId, '42');
    assert.equal(config.generation.strategies.enabled, false);
    assert.equal(config.generation.strategies.diversityWeight, DEFAULT_CONFIG.generation.strategies.diversityWeight);
    assert.equal(config.anthropic.maxTokens, DEFAULT_CONFIG.anthropic.maxTokens);
    assert.equal(readFileSync(path, 'utf8'), original);
    process.env.SHIPPOST_X_API_TIER = 'invalid';
    assert.equal(new FileSystemService(dir).loadConfig().x.apiTier, 'free');
  } finally {
    keys.forEach((key, i) => before[i] === undefined ? delete process.env[key] : process.env[key] = before[i]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review requires approval before staging and handles retries and concurrent requests', async () => {
  const dir = workspace();
  const postsPath = join(dir, 'posts.jsonl');
  writeFileSync(postsPath, [post('one'), post('two', 'keep'), post('fail'), post('rejected', 'rejected')].map(p => JSON.stringify(p)).join('\n') + '\n');
  const readPosts = () => readFileSync(postsPath, 'utf8').trim().split('\n').map(JSON.parse);
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const service = new URL('../dist/services/typefully.js', import.meta.url).href;
  const ui = new URL('../dist/commands/ui/index.js', import.meta.url).href;
  // Replace external draft creation in the child process; never call Typefully.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { TypefullyService } from ${JSON.stringify(service)};
    import { uiCommand } from ${JSON.stringify(ui)};
    let calls = 0;
    TypefullyService.prototype.createDraft = async function(content, platform) {
      calls++;
      await new Promise(r => setTimeout(r, 150));
      if (content === 'fail') throw new Error('simulated failure');
      return { id: String(calls), share_url: 'https://example.com/draft' };
    };
    await uiCommand({ port: ${port} });
  `], { cwd: dir, env: { ...process.env, TYPEFULLY_API_KEY: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000);
      child.stdout.on('data', data => { if (data.toString().includes('ship ui running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited: ' + code)); });
    });
    const api = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const source = join(dir, 'input', 'synthetic.txt');
    writeFileSync(source, 'Synthetic meeting.');
    const fs = new FileSystemService(dir);
    fs.saveState(fs.markFileProcessed(source, 1, fs.loadState(), 'social'));
    assert.equal((await api('transcripts?target=social')).body.transcripts.length, 0);
    assert.equal((await api('transcripts?target=blog')).body.transcripts.length, 1);
    assert.equal((await api('transcripts?target=invalid')).status, 400);
    assert.equal((await api('generate', { files: ['synthetic.txt'], target: 'invalid' })).status, 400);
    assert.equal((await api('transcripts/skip', { name: 'synthetic.txt', target: 'blog' })).status, 200);
    assert.equal((await api('transcripts?target=blog')).body.transcripts.length, 0);
    assert.equal((await api('transcripts?target=revisions')).body.transcripts.length, 1);
    assert.equal((await api('stage-approved', {})).status, 404);
    assert.equal((await api('decision', { id: 'one', action: 'stage' })).status, 400);
    assert.equal((await api('decision', { id: 'one', action: 'approve', content: 'edited' })).status, 200);
    assert.equal(readPosts()[0].metadata.typefullyDraftId, undefined);
    assert.equal((await api('approved-posts')).body.posts[0].content, 'edited');
    assert.deepEqual((await api('posts')).body.posts.map(p => p.id).sort(), ['fail', 'two']);
    assert.equal((await api('decision', { id: 'one', action: 'approve' })).status, 409);
    const results = await Promise.all([api('stage-approved', {}), api('stage-approved', {})]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(readPosts()[0].status, 'staged');
    assert.equal(readPosts()[0].metadata.typefullyDraftId, '1');
    assert.equal((await api('decision', { id: 'one', action: 'approve' })).status, 409);
    assert.equal((await api('decision', { id: 'two', action: 'reject' })).status, 200);
    assert.equal((await api('decision', { id: 'fail', action: 'approve' })).status, 200);
    assert.equal((await api('stage-approved', {})).status, 500);
    assert.equal(readPosts()[2].status, 'approved');
    assert.equal((await api('stage-approved', {})).status, 500); // lock released after failure
  } finally {
    child.kill();
    await once(child, 'exit');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal approval persists without Typefully credentials', async () => {
  const dir = workspace();
  const path = join(dir, 'posts.jsonl');
  writeFileSync(path, JSON.stringify(post('cli')) + '\n');
  const env = { ...process.env };
  delete env.TYPEFULLY_API_KEY;
  const review = new URL('../dist/commands/review.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { reviewCommand } from ${JSON.stringify(review)}; await reviewCommand({});`], { cwd: dir, env });
  try {
    child.stdin.end('a\n');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.status, 'approved');
    assert.equal(saved.metadata.typefullyDraftId, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
