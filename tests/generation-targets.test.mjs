import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from '../dist/services/file-system.js';
import { DEFAULT_CONFIG } from '../dist/types/config.js';

const exec = promisify(execFile);
const workUrl = new URL('../dist/commands/work.js', import.meta.url).href;
const llmUrl = new URL('../dist/services/ollama.js', import.meta.url).href;
const original = '---\ntitle: Existing article\ndate: 2026-01-01\n---\nExisting body.\n';
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'shippost-targets-'));
  for (const dir of ['input', 'prompts', 'src/content/posts', 'src/content/drafts', 'public/images/posts']) mkdirSync(join(cwd, dir), { recursive: true });
  writeFileSync(join(cwd, '.shippostrc.json'), JSON.stringify({ ...DEFAULT_CONFIG, generation: { strategies: { enabled: false } } }));
  for (const name of ['style', 'system', 'work', 'banger-eval']) writeFileSync(join(cwd, 'prompts', name + '.md'), name === 'banger-eval' ? 'EVALUATE {{post}}' : 'Synthetic fixture');
  writeFileSync(join(cwd, 'prompts/blog-revision.md'), 'REVISE {{content}} USING {{transcript}}');
  writeFileSync(join(cwd, 'input/meeting.txt'), 'Synthetic meeting transcript.');
  writeFileSync(join(cwd, 'src/content/posts/existing.mdx'), original);
  writeFileSync(join(cwd, 'public/images/posts/existing.svg'), '<svg/>');
  return cwd;
}
async function run(cwd, options = {}, mode = 'social') {
  return exec(process.execPath, ['--input-type=module', '-e', `
    import { workCommand } from ${JSON.stringify(workUrl)};
    import { OllamaService } from ${JSON.stringify(llmUrl)};
    OllamaService.prototype.ensureAvailable = async () => {};
    let calls = 0;
    OllamaService.prototype.generate = async (prompt) => {
      calls++;
      const mode = ${JSON.stringify(mode)};
      if (mode === 'fail') throw new Error('simulated model failure');
      if (mode === 'revisions') {
        if (!prompt.startsWith('REVISE') || prompt.includes('{{')) throw new Error('wrong revision prompt');
        return '---\\ntitle: Proposed article\\n---\\nProposed body.';
      }
      if (mode === 'blog') return JSON.stringify({ essays: [{ title: 'New essay', slug: 'existing', body: 'New draft with [context](/existing).', tags: ['ai'], takeaways: ['A', 'B', 'C'], faq: [], sources: [] }] });
      if (prompt.includes('atomic arguments') || prompt.startsWith('REVISE')) throw new Error('social run requested a blog mutation');
      if (mode === 'partial' && prompt.includes('strategy-two')) throw new Error('second strategy failed');
      return prompt.startsWith('EVALUATE') ? '{}' : '[PLATFORM: x] A concrete synthetic lesson.';
    };
    await workCommand(${JSON.stringify({ all: true, ...options })});
  `], { cwd, timeout: 15000 });
}

test('default social run leaves articles and assets unchanged; blog and revisions are independent', async () => {
  const cwd = fixture();
  try {
    await run(cwd);
    const posts = readFileSync(join(cwd, 'posts.jsonl'), 'utf8');
    assert.equal(JSON.parse(posts).status, 'new');
    assert.deepEqual(readdirSync(join(cwd, 'src/content/drafts')), []);
    assert.deepEqual(readdirSync(join(cwd, 'public/images/posts')), ['existing.svg']);
    assert.equal(readFileSync(join(cwd, 'src/content/posts/existing.mdx'), 'utf8'), original);
    assert.equal(existsSync(join(cwd, '.shippost-revisions')), false);
    await run(cwd);
    assert.equal(readFileSync(join(cwd, 'posts.jsonl'), 'utf8'), posts);
    await run(cwd, { target: 'blog' }, 'blog');
    assert.deepEqual(readdirSync(join(cwd, 'src/content/drafts')), ['existing-2.mdx']);
    assert.equal(readFileSync(join(cwd, 'posts.jsonl'), 'utf8'), posts);
    assert.equal(readFileSync(join(cwd, 'src/content/posts/existing.mdx'), 'utf8'), original);
    await run(cwd, { target: 'revisions' }, 'revisions');
    assert.equal(readFileSync(join(cwd, 'src/content/posts/existing.mdx'), 'utf8'), original);
    const proposals = readdirSync(join(cwd, '.shippost-revisions'));
    assert.equal(proposals.filter(p => p.endsWith('.mdx')).length, 2);
    const fs = new FileSystemService(cwd);
    for (const target of ['social', 'blog', 'revisions']) assert.ok(fs.isFileProcessed(join(cwd, 'input/meeting.txt'), fs.loadState(), target));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('failed targets remain retryable without repeating successful outputs', async () => {
  const cwd = fixture();
  try {
    await run(cwd);
    const posts = readFileSync(join(cwd, 'posts.jsonl'), 'utf8');
    await assert.rejects(run(cwd, { target: 'blog' }, 'fail'));
    const fs = new FileSystemService(cwd);
    assert.equal(fs.isFileProcessed(join(cwd, 'input/meeting.txt'), fs.loadState(), 'blog'), false);
    await run(cwd, { target: 'blog' }, 'blog');
    assert.equal(readFileSync(join(cwd, 'posts.jsonl'), 'utf8'), posts);
    await assert.rejects(run(cwd, { target: 'invalid' }));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('legacy completion is preserved when explicitly rerunning one target', async () => {
  const cwd = fixture();
  try {
    const fs = new FileSystemService(cwd);
    const path = join(cwd, 'input/meeting.txt');
    const legacy = { processedFiles: { [path]: { path, processedAt: '2026-01-01', modifiedAt: '2026-01-01', postsGenerated: 8 } } };
    fs.saveState(legacy);
    for (const target of ['social', 'blog', 'revisions']) assert.ok(fs.isFileProcessed(path, legacy, target));
    await run(cwd, { target: 'blog' }, 'fail'); // skipped, no model call
    assert.deepEqual(fs.loadState(), legacy);
    await run(cwd, { target: 'blog', force: true }, 'blog');
    for (const target of ['social', 'blog', 'revisions']) assert.ok(fs.isFileProcessed(path, fs.loadState(), target));
    assert.equal(existsSync(join(cwd, 'posts.jsonl')), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('partial strategy failure does not save an incomplete social batch', async () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, '.shippostrc.json'), JSON.stringify(DEFAULT_CONFIG));
    writeFileSync(join(cwd, 'strategies.json'), JSON.stringify(['one', 'two'].map(id => ({ id, name: id, category: 'insight', prompt: 'strategy-' + id }))));
    await assert.rejects(run(cwd, { strategies: 'one,two' }, 'partial'));
    assert.equal(existsSync(join(cwd, 'posts.jsonl')), false);
    const fs = new FileSystemService(cwd);
    assert.equal(fs.isFileProcessed(join(cwd, 'input/meeting.txt'), fs.loadState(), 'social'), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('negated strategies option uses direct generation even when config enables strategies', async () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, '.shippostrc.json'), JSON.stringify(DEFAULT_CONFIG));
    await run(cwd, { strategies: false });
    assert.equal(JSON.parse(readFileSync(join(cwd, 'posts.jsonl'), 'utf8')).status, 'new');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
