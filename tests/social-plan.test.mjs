import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSocialPosts, textOnlyStrategies, renderPrompt } from '../dist/services/social-plan.js';
import { FileSystemService } from '../dist/services/file-system.js';
const strategies = [
  { id: 'lesson', name: 'Practical lesson', prompt: 'Explain a grounded lesson', applicability: { worksWithAnyContent: true } },
  { id: 'photo', name: 'Photo of the week', prompt: 'Share a photo', applicability: { worksWithAnyContent: true } },
  { id: 'visual', name: 'Demonstration', prompt: 'Show a result', applicability: { requiresVisualAsset: true } },
];
test('universal applicability cannot select unsupported visual strategies', () => {
  assert.deepEqual(textOnlyStrategies(strategies).map(s => s.id), ['lesson']);
});
test('one planning request assigns grounded angles and permits fewer than the maximum', async () => {
  let calls = 0;
  const llm = { generate: async (prompt, purpose) => {
    calls++;
    assert.equal(purpose, 'social-plan');
    assert.ok(prompt.includes('private style rule'));
    assert.ok(!prompt.includes('Photo of the week'));
    return JSON.stringify({ posts: [{ strategyId: 'lesson', angle: 'Keep scope narrow', evidence: 'Scope grew before reliability', platform: 'x' }] });
  } };
  const template = readFileSync(new URL('../src/templates/social-plan.md', import.meta.url), 'utf8');
  const result = await planSocialPosts(llm, template, 'private style rule', 'Scope grew before reliability', textOnlyStrategies(strategies), 8);
  assert.equal(result.length, 1); assert.equal(calls, 1);
});
test('invalid plans stop before spending tokens on unsupported drafts', async () => {
  const good = { strategyId: 'lesson', angle: 'Keep scope narrow', evidence: 'Scope grew', platform: 'x' };
  for (const posts of [[good, { ...good, angle: 'KEEP scope narrow!' }], [{ ...good, strategyId: 'invented' }], [{ ...good, evidence: '' }], [{ ...good, platform: 'unknown' }], []]) {
    await assert.rejects(planSocialPosts({ generate: async () => JSON.stringify({ posts }) }, '{{transcript}}', '', 'notes', strategies, 8));
  }
});
test('new editable task prompts are installed without overwriting customization or substituting note text', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'task-prompts-'));
  try {
    const fs = new FileSystemService(cwd);
    assert.ok(fs.loadPrompt('social-strategy.md').includes('exactly ONE'));
    writeFileSync(join(cwd, 'prompts/social-strategy.md'), 'Custom single-post instruction');
    assert.equal(fs.loadPrompt('social-strategy.md'), 'Custom single-post instruction');
    assert.equal(renderPrompt('{{transcript}} {{style}}', { transcript: 'literal {{style}} in source', style: 'private style' }), 'literal {{style}} in source private style');
    assert.ok(!fs.loadPrompt('blog-draft.md').includes('No JSON'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
