import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XAuthService } from '../dist/services/x-auth.js';
import { XApiService } from '../dist/services/x-api.js';
import { getMeWithMetrics, getRecentTweetsWithMetrics } from '../dist/commands/stats.js';

test('disabled workspace blocks OAuth, API clients, and direct analytics clients', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shippost-x-disabled-'));
  const before = process.cwd();
  try {
    writeFileSync(join(dir, '.shippostrc.json'), JSON.stringify({ x: { enabled: false } }));
    assert.throws(() => new XAuthService(dir, 'synthetic'), /X API access is disabled/);
    process.chdir(dir);
    assert.throws(() => new XApiService('synthetic'), /X API access is disabled/);
    assert.equal(await getMeWithMetrics('synthetic'), null);
    await assert.rejects(() => getRecentTweetsWithMetrics('synthetic', 'synthetic', 1), error => /X API access is disabled/.test(error.message));
  } finally { process.chdir(before); rmSync(dir, { recursive: true, force: true }); }
});
