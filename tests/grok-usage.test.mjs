import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grokUsage } from '../dist/services/grok-usage.js';
test('Grok usage sums session totals once and never estimates plan allowance', () => {
 const cwd = mkdtempSync(join(tmpdir(), 'grok-usage-'));
 try {
  assert.equal(grokUsage(cwd).tokens, 0);
  const dir=join(cwd,'.shippost-grok','sessions','workspace','session'); mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'usage.json'),JSON.stringify({session:{totalTokens:100,modelCalls:2},turns:[{totalTokens:100}],updatedAt:'2026-10-05T12:00:00Z'}));
  const result=grokUsage(cwd); assert.equal(result.tokens,100); assert.equal(result.calls,2); assert.equal(result.remainingPercent,null); assert.equal(result.resetsAt,null);
  writeFileSync(join(dir,'usage.json'),'{partial'); assert.equal(grokUsage(cwd).tokens,0);
 } finally {rmSync(cwd,{recursive:true,force:true});}
});
