import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationProgress } from '../dist/commands/ui/progress.js';

test('progress excludes setup and previous targets', () => {
  assert.equal(generationProgress(['▸ social: a.md', 'Substep 4/16 · Evaluating social posts', '▸ blog: a.md', '[3/3] Processing files...']), null);
  assert.equal(generationProgress(['[1/3] Checking environment...']), null);
});
test('progress follows the latest phase and validates counts', () => {
  assert.deepEqual(generationProgress(['▸ blog: a.md', 'Substep 1/1 · Drafting essays', 'Substep 2/3 · Preparing drafts and covers', 'Substep 9/3 · Invalid']), { current: 2, total: 3, label: 'Preparing drafts and covers' });
  assert.deepEqual(generationProgress(['▸ revisions: a.md', 'Substep 3/10 · Checking articles']), { current: 3, total: 10, label: 'Checking articles' });
});
test('already running social workers report post progress', () => {
  assert.deepEqual(generationProgress(['▸ social: a.md', '[3/3] Processing files...', '  Generating 8 posts...', '  [2/8] Strategy...']), { current: 2, total: 8, label: 'Social posts' });
});

test('preparation shows zero of the planned posts before the first result', () => {
  assert.deepEqual(generationProgress(['▸ social: a.md', 'Processing file...'], 8), { current: 0, total: 8, label: 'Preparing social posts' });
  assert.deepEqual(generationProgress(['▸ social: a.md', 'Substep 0/8 · Choosing post strategies']), { current: 0, total: 8, label: 'Choosing post strategies' });
});

test('older active workers show post count instead of double-counting evaluation', () => {
  assert.deepEqual(generationProgress(['▸ social: a.md', 'Generating 8 posts...', 'Substep 6/16 · Evaluating social posts']), { current: 3, total: 8, label: 'Evaluating social posts' });
});
