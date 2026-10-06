import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrokService } from '../dist/services/grok.js';
import { GrokAuth } from '../dist/services/grok-auth.js';
import { DEFAULT_CONFIG } from '../dist/types/config.js';
const config = { ...DEFAULT_CONFIG, llm: { provider: 'grok' }, grok: { model: 'grok-4.7' } };
function workspace(t, expires = Date.now() + 3600000) {
  const cwd = mkdtempSync(join(tmpdir(), 'grok-test-'));
  mkdirSync(join(cwd, '.shippost-grok'));
  writeFileSync(join(cwd, '.shippost-grok/subscription.json'), JSON.stringify({ access: 'subscription-token', refresh: 'refresh-token', expires }));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
test('direct generation uses only subscription auth and no tools or temperature', async t => {
  const cwd = workspace(t);
  const original = globalThis.fetch; t.after(() => globalThis.fetch = original);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.x.ai/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer subscription-token');
    assert.deepEqual(JSON.parse(init.body), { model: 'grok-4.7', input: 'Synthetic meeting prompt', tools: [], store: false, reasoning: { effort: 'high' } });
    return Response.json({ status: 'completed', usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 800 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 250 } }, output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Generated draft' }] }] });
  };
  const service = new GrokService(config, cwd);
  assert.equal(service.getTemperature(), undefined);
  assert.equal(await service.generate('Synthetic meeting prompt', 'social-draft'), 'Generated draft');
  const telemetryPath = join(cwd, '.shippost-grok/requests.jsonl');
  const raw = readFileSync(telemetryPath, 'utf8');
  const record = JSON.parse(raw);
  assert.equal(record.purpose, 'social-draft');
  assert.equal(record.reasoningEffort, 'high');
  assert.equal(record.inputTokens, 1200);
  assert.equal(record.cachedInputTokens, 800);
  assert.equal(record.reasoningTokens, 250);
  assert.equal(record.outcome, 'completed');
  assert.ok(record.elapsedMs >= 0);
  assert.equal(statSync(telemetryPath).mode & 0o777, 0o600);
  for (const secret of ['Synthetic meeting prompt', 'Generated draft', 'subscription-token', 'refresh-token']) assert.ok(!raw.includes(secret));
});
test('errors distinguish authentication, allowance and server failures without leaking bodies', async t => {
  const service = new GrokService(config, workspace(t));
  const original = globalThis.fetch; t.after(() => globalThis.fetch = original);
  for (const [status, message] of [[401, /Reconnect/], [429, /usage is limited/], [500, /HTTP 500/]]) {
    globalThis.fetch = async () => Response.json({ error: 'secret-token private-prompt' }, { status });
    await assert.rejects(service.generate('test'), error => message.test(error.message) && !/secret|private/.test(error.message));
  }
  globalThis.fetch = async () => Response.json({ status: 'incomplete', output: [] });
  await assert.rejects(service.generate('test'), /did not finish/);
  globalThis.fetch = async () => Response.json({ status: 'completed', output: [] });
  await assert.rejects(service.generate('test'), /no content/);
});
test('concurrent refreshes rotate and persist tokens once with private permissions', async t => {
  const cwd = workspace(t, 0);
  const original = globalThis.fetch; t.after(() => globalThis.fetch = original);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://auth.x.ai/oauth2/token');
    assert.equal(init.body.get('grant_type'), 'refresh_token');
    await new Promise(r => setTimeout(r, 30));
    return Response.json({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
  };
  assert.deepEqual(await Promise.all([new GrokAuth(cwd).accessToken(), new GrokAuth(cwd).accessToken()]), ['new-access', 'new-access']);
  assert.equal(calls, 1);
  const path = join(cwd, '.shippost-grok/subscription.json');
  assert.equal(JSON.parse(readFileSync(path)).refresh, 'rotated-refresh');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
test('device flow keeps credentials server-side and respects polling backoff', async t => {
  const cwd = workspace(t);
  const original = globalThis.fetch, now = Date.now;
  t.after(() => { globalThis.fetch = original; Date.now = now; });
  let time = now(), calls = 0; Date.now = () => time;
  globalThis.fetch = async url => {
    calls++;
    if (String(url).endsWith('/device/code')) return Response.json({ device_code: 'private-device', user_code: 'PUBLIC', verification_uri: 'https://auth.x.ai/verify', expires_in: 300, interval: 5 });
    if (calls === 2) return Response.json({ error: 'slow_down' }, { status: 400 });
    return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
  };
  const auth = new GrokAuth(cwd);
  assert.deepEqual(await auth.start(), { url: 'https://auth.x.ai/verify', code: 'PUBLIC' });
  assert.deepEqual(await auth.poll(), { status: 'pending' }); assert.equal(calls, 1);
  time += 5000; await auth.poll(); assert.equal(calls, 2);
  time += 5000; await auth.poll(); assert.equal(calls, 2);
  time += 5000; assert.deepEqual(await auth.poll(), { status: 'connected' });
  assert.equal(await auth.accessToken(), 'new-access');
});
test('existing native sign-in is imported without launching Grok Build', async t => {
  const cwd = workspace(t); rmSync(join(cwd, '.shippost-grok/subscription.json'));
  writeFileSync(join(cwd, '.shippost-grok/auth.json'), JSON.stringify({ 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': { key: 'existing-access', refresh_token: 'existing-refresh', expires_at: new Date(Date.now() + 3600000).toISOString() } }));
  assert.equal(await new GrokAuth(cwd).accessToken(), 'existing-access');
});

test('explicit reasoning effort is forwarded', async t => {
  const cwd = workspace(t);
  const original = globalThis.fetch; t.after(() => globalThis.fetch = original);
  globalThis.fetch = async (url, init) => {
    assert.equal(JSON.parse(init.body).reasoning.effort, 'medium');
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Draft' }] }] });
  };
  assert.equal(await new GrokService({ ...config, grok: { model: 'grok-4.7', reasoningEffort: 'medium' } }, cwd).generate('test'), 'Draft');
});
