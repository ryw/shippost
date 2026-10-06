import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, realpathSync, lstatSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { cp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FileSystemService } from './file-system.js';

const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const LEDGER = '.shippost-blog-prs.json';
export type Run = (command: string, args: string[], cwd: string) => Promise<string>;
export const runCommand: Run = async (command, args, cwd) => {
  try {
    return (await exec(command, args, { cwd, timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1' } })).stdout;
  } catch (error: any) {
    // Full validation diagnostics stay local; do not return environment or model inputs.
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(`${command} ${args[0] || ''} failed${output ? ': ' + output.slice(-6000) : ''}`);
  }
};
export interface Bundle {
  id: string; source: string; fingerprint: string;
  files: Record<string, string>;
  newPosts: string[]; revisions: string[];
  originalHashes: Record<string, string>;
}
export interface PrRecord {
  source: string; fingerprint: string; status: 'preparing' | 'failed' | 'opened' | 'empty';
  branch: string; url?: string; error?: string; updatedAt: string;
}
export function readBlogPrStatus(cwd: string): Record<string, PrRecord> {
  const file = join(cwd, LEDGER);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}
function saveStatus(cwd: string, records: Record<string, PrRecord>) {
  const file = join(cwd, LEDGER);
  writeFileSync(file + '.tmp', JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
/** Never follow an input/output symlink outside the selected repository. */
export function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (target === resolve(root) || !target.startsWith(resolve(root) + sep)) throw new Error('Content path must stay inside the repository');
  let parent = target;
  while (!existsSync(parent)) parent = dirname(parent);
  const actual = realpathSync(parent);
  if (actual !== realpathSync(root) && !actual.startsWith(realpathSync(root) + sep)) throw new Error('Content symlink escapes the repository');
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Content must not be a symlink');
  return target;
}
function frontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Article is missing frontmatter');
  return match[1];
}
function scalar(content: string, key: string): string | undefined {
  const value = frontmatter(content).match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim();
  if (!value) return undefined;
  if (value.startsWith('"')) return JSON.parse(value);
  return value.replace(/^'|'$/g, '');
}
export function publicationCopy(content: string): string {
  const fm = frontmatter(content).replace(/^source:.*(?:\r?\n|$)/m, '').replace(/^draft:.*(?:\r?\n|$)/m, '').trimEnd();
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, () => `---\n${fm}\ndraft: false\n---`).trimEnd() + '\n';
}
const mdxNames = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(name => /^[a-z0-9]+(?:-[a-z0-9]+)*\.mdx$/.test(name)).sort() : [];

/** A meeting is ready only after BOTH targets succeed. Failed/partial outputs cannot leak into a PR. */
export function collectBlogBundles(cwd: string): Bundle[] {
  const fs = new FileSystemService(cwd);
  const config = fs.loadConfig();
  const drafts = safePath(cwd, config.blog?.outputDir || 'src/content/drafts');
  const ready = new Map<string, Bundle>();
  for (const info of Object.values(fs.loadState().processedFiles)) {
    if (!info.targets?.blog || !info.targets?.revisions) continue;
    const source = relative(cwd, info.path);
    if (!source.startsWith('input/') || !existsSync(safePath(cwd, source))) continue;
    ready.set(source, { id: hash(source).slice(0, 16), source, fingerprint: '', files: {}, newPosts: [], revisions: [], originalHashes: {} });
  }
  for (const name of mdxNames(drafts)) {
    const content = readFileSync(safePath(cwd, relative(cwd, join(drafts, name))), 'utf8');
    const source = scalar(content, 'source');
    const bundle = source && ready.get(source);
    if (!bundle) continue;
    const image = scalar(content, 'image');
    if (!image || !/^\/images\/posts\/[a-z0-9-]+\.svg$/.test(image)) throw new Error(`Missing local SVG cover for ${name}`);
    bundle.files['src/content/posts/' + name] = publicationCopy(content);
    bundle.files['public' + image] = readFileSync(safePath(cwd, 'public' + image), 'utf8');
    bundle.newPosts.push(name.replace(/\.mdx$/, ''));
  }
  const proposals = join(cwd, '.shippost-revisions');
  if (existsSync(proposals)) for (const name of readdirSync(proposals).filter(n => /^[\w-]+\.json$/.test(n)).sort()) {
    const meta = JSON.parse(readFileSync(safePath(cwd, '.shippost-revisions/' + name), 'utf8'));
    const bundle = ready.get(meta.sourceFile);
    if (!bundle) continue;
    const proposal = readFileSync(safePath(cwd, '.shippost-revisions/' + name.replace(/\.json$/, '.mdx')), 'utf8');
    if (!/^src\/content\/(posts|drafts)\/[a-z0-9-]+\.mdx$/.test(meta.originalPath)) throw new Error('Revision has an invalid original path');
    const target = meta.originalPath.replace('/drafts/', '/posts/');
    // Same-meeting draft revisions are folded into their publication copy.
    if (bundle.files[target]) {
      const original = readFileSync(safePath(cwd, meta.originalPath), 'utf8');
      if (hash(original) !== meta.originalHash) throw new Error('Draft changed since its revision was generated');
    } else {
      if (bundle.originalHashes[target]) throw new Error('Multiple proposals for one article require editorial review');
      bundle.originalHashes[target] = meta.originalHash;
    }
    bundle.files[target] = publicationCopy(proposal);
    bundle.revisions.push(target);
  }
  for (const bundle of ready.values()) bundle.fingerprint = hash(JSON.stringify([bundle.files, bundle.originalHashes]));
  return [...ready.values()];
}

export function addHomepagePosts(homepage: string, bundle: Bundle): string {
  for (const slug of bundle.newPosts) {
    if (homepage.includes(`"${slug}"`)) continue;
    const content = bundle.files[`src/content/posts/${slug}.mdx`];
    const links = [...content.matchAll(/\]\(\/([a-z0-9-]+)(?:#[^)]+)?\)/g)].map(m => m[1]);
    const anchor = links.find(link => homepage.includes(`"${link}"`));
    if (!anchor) throw new Error(`Choose a homepage chapter for ${slug}: no linked essay is in the table of contents`);
    homepage = homepage.replace(new RegExp(`^(\\s*)"${anchor}",`, 'm'), `$1"${anchor}",\n$1"${slug}",`);
    if (!homepage.includes(`"${slug}"`)) throw new Error(`Could not place ${slug} in the homepage`);
  }
  return homepage;
}

async function installDependencies(cwd: string, worktree: string, run: Run) {
  // Reuse the workspace's installed environment only for identical dependency manifests.
  const manifests = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
  const matches = manifests.every(path => {
    const a = join(cwd, path), b = join(worktree, path);
    return existsSync(a) === existsSync(b) && (!existsSync(a) || readFileSync(a).equals(readFileSync(b)));
  });
  if (cwd !== worktree && matches && existsSync(join(cwd, 'node_modules/.pnpm'))) {
    await cp(join(cwd, 'node_modules'), join(worktree, 'node_modules'), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  } else await run('pnpm', ['install', '--frozen-lockfile'], worktree);
}

export async function prepareBlogBundle(cwd: string, worktree: string, bundle: Bundle, run: Run) {
  for (const [path, expected] of Object.entries(bundle.originalHashes)) {
    const target = safePath(worktree, path);
    if (!existsSync(target) || hash(readFileSync(target)) !== expected) throw new Error(`Revision needs rebase: ${path} changed or is not published on main`);
  }
  for (const slug of bundle.newPosts) {
    if (existsSync(safePath(worktree, `src/content/posts/${slug}.mdx`))) throw new Error(`Published article already exists: ${slug}`);
  }
  for (const [path, content] of Object.entries(bundle.files)) {
    if (!/^(src\/content\/posts\/[a-z0-9-]+\.mdx|public\/images\/posts\/[a-z0-9-]+\.svg)$/.test(path)) throw new Error('Unexpected publication path');
    if (path.startsWith('public/') && existsSync(safePath(worktree, path))) throw new Error(`Cover already exists: ${path}`);
    const target = safePath(worktree, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const home = safePath(worktree, 'src/lib/homepage-sections.ts');
  if (bundle.newPosts.length) writeFileSync(home, addHomepagePosts(readFileSync(home, 'utf8'), bundle));
  const paths = [...Object.keys(bundle.files), ...(bundle.newPosts.length ? ['src/lib/homepage-sections.ts'] : [])];
  await run('git', ['add', '--', ...paths], worktree);
  await installDependencies(cwd, worktree, run);
  await run('pnpm', ['lint'], worktree);
  await run('pnpm', ['build'], worktree);
  // Lifecycle scripts/builds must not add unrelated files to the commit.
  const staged = (await run('git', ['diff', '--cached', '--name-only'], worktree)).trim().split('\n').filter(Boolean);
  if (staged.some(path => !paths.includes(path))) throw new Error('Unexpected staged files; refusing to publish');
  const unstaged = (await run('git', ['diff', '--name-only'], worktree)).trim();
  if (unstaged) throw new Error('Validation changed tracked files; review required');
}

async function openBundle(cwd: string, bundle: Bundle, branch: string, run: Run): Promise<string> {
  const config = new FileSystemService(cwd).loadConfig().blog?.pullRequests;
  const repository = config?.repository || 'ryw/rywalker.com';
  const base = config?.baseBranch || 'main';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w][\w./-]*$/.test(base) || base.includes('..')) throw new Error('Invalid GitHub repository or base branch');
  const origin = (await run('git', ['remote', 'get-url', 'origin'], cwd)).trim().replace(/\.git$/, '');
  if (![ `https://github.com/${repository}`, `git@github.com:${repository}` ].includes(origin)) throw new Error('Blog repository must match this workspace origin');
  const prs = JSON.parse(await run('gh', ['pr', 'list', '--repo', repository, '--head', branch, '--state', 'all', '--json', 'url'], cwd));
  if (prs.length) return prs[0].url;
  await run('git', ['fetch', 'origin', base], cwd);
  const remote = (await run('git', ['ls-remote', '--heads', 'origin', branch], cwd)).trim();
  const temp = mkdtempSync(join(tmpdir(), 'shippost-pr-'));
  const worktree = join(temp, 'repo');
  try {
    if (remote) await run('git', ['fetch', 'origin', branch], cwd);
    await run('git', ['worktree', 'add', '--detach', worktree, remote ? 'FETCH_HEAD' : `origin/${base}`], cwd);
    await run('git', ['switch', '-C', branch], worktree);
    if (!remote) {
      if (process.env.TEMBO_SESSION_ID) await run('tembo', ['merge', `origin/${base}`], worktree);
      await prepareBlogBundle(cwd, worktree, bundle, run);
      const title = `content: ${bundle.newPosts[0] || 'article revisions'}`;
      if (process.env.TEMBO_SESSION_ID) await run('tembo', ['commit', '-m', title, '--repository-url', `https://github.com/${repository}`], worktree);
      else {
        await run('git', ['commit', '-m', title], worktree);
        await run('git', ['push', '-u', 'origin', branch], worktree);
      }
    }
    if (remote) {
      // Recover a push that succeeded before PR creation without trusting an arbitrary branch.
      const allowed = [...Object.keys(bundle.files), 'src/lib/homepage-sections.ts'];
      const changed = (await run('git', ['diff', '--name-only', `origin/${base}...HEAD`], worktree)).trim().split('\n').filter(Boolean);
      if (changed.some(path => !allowed.includes(path))) throw new Error('Recovery branch contains unrelated changes');
      for (const [path, content] of Object.entries(bundle.files)) {
        if (readFileSync(safePath(worktree, path), 'utf8') !== content) throw new Error('Recovery branch differs from generated content; review required');
      }
      await installDependencies(cwd, worktree, run);
      await run('pnpm', ['lint'], worktree);
      await run('pnpm', ['build'], worktree);
    }
    const title = bundle.newPosts.length ? `Review: ${bundle.newPosts[0]}${bundle.newPosts.length > 1 ? ` + ${bundle.newPosts.length - 1} more` : ''}${bundle.revisions.length ? ' and revisions' : ''}` : 'Review: suggested article revisions';
    const body = `Generated website content from one meeting. Review all new essays and suggested edits together before merging.\n\nNew essays: ${bundle.newPosts.join(', ') || 'None'}.\n\nSuggested revisions: ${bundle.revisions.join(', ') || 'None selected'}.\n\nIncludes article covers and homepage placement. Meeting notes and local workspace state are excluded. Merging publishes these changes.\n\nValidation: pnpm lint and pnpm build passed in an isolated checkout before pushing. Dependencies are reused from the existing workspace when its manifests match; otherwise installation is frozen. A clean dependency install is a separate check.\n`;
    const bodyPath = join(temp, 'body.md'); writeFileSync(bodyPath, body);
    if (process.env.TEMBO_SESSION_ID) await run('tembo', ['pull-request', 'create', '--title', title, '--body-file', bodyPath, '--head-branch', branch, '--base-branch', base, '--draft', '--repository-url', `https://github.com/${repository}`], worktree);
    else await run('gh', ['pr', 'create', '--repo', repository, '--title', title, '--body-file', bodyPath, '--head', branch, '--base', base, '--draft'], worktree);
    const created = JSON.parse(await run('gh', ['pr', 'list', '--repo', repository, '--head', branch, '--state', 'all', '--json', 'url'], cwd));
    if (!created[0]?.url) throw new Error('PR was not found after creation; retry to reconcile');
    return created[0].url;
  } finally {
    if (existsSync(worktree)) await run('git', ['worktree', 'remove', '--force', worktree], cwd).catch(() => {});
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Cross-process lock: the UI and standalone watcher can safely overlap. */
export async function processBlogPrs(cwd: string, options: { retry?: boolean; run?: Run } = {}) {
  if (!new FileSystemService(cwd).loadConfig().blog?.pullRequests?.enabled) return;
  const lock = join(cwd, '.shippost-blog-prs.lock');
  if (existsSync(lock)) {
    try { process.kill(Number(readFileSync(join(lock, 'pid'), 'utf8')), 0); return; }
    catch (error: any) { if (error.code !== 'ESRCH') return; rmSync(lock, { recursive: true }); }
  }
  try { mkdirSync(lock); } catch (error: any) { if (error.code === 'EEXIST') return; throw error; }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  try {
    const records = readBlogPrStatus(cwd);
    for (const bundle of collectBlogBundles(cwd)) {
      const previous = records[bundle.id];
      if (previous?.status === 'opened' || (previous?.fingerprint === bundle.fingerprint && ['failed', 'empty'].includes(previous.status) && !options.retry)) continue;
      const record: PrRecord = { source: bundle.source, fingerprint: bundle.fingerprint, status: Object.keys(bundle.files).length ? 'preparing' : 'empty', branch: `tembo/meeting-${bundle.id}`, updatedAt: new Date().toISOString() };
      records[bundle.id] = record; saveStatus(cwd, records);
      if (record.status === 'empty') continue;
      try { record.url = await openBundle(cwd, bundle, record.branch, options.run || runCommand); record.status = 'opened'; }
      catch (error) { record.status = 'failed'; record.error = (error as Error).message; }
      record.updatedAt = new Date().toISOString(); saveStatus(cwd, records);
    }
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

const workers = new Map<string, ReturnType<typeof spawn>>();
export function startBlogPrWorker(cwd: string) {
  if (workers.has(cwd) || !existsSync(join(cwd, '.shippostrc.json')) || !new FileSystemService(cwd).loadConfig().blog?.pullRequests?.enabled) return;
  const entry = fileURLToPath(new URL('../index.js', import.meta.url));
  const child = spawn(process.execPath, [entry, 'blog-prs', '--watch', '--parent', String(process.pid)], { cwd, stdio: 'ignore' });
  workers.set(cwd, child);
  child.once('exit', () => workers.delete(cwd));
  child.once('error', () => workers.delete(cwd));
  child.unref();
  process.once('exit', () => child.kill());
}
