import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectBlogBundles, publicationCopy, addHomepagePosts, prepareBlogBundle, processBlogPrs, readBlogPrStatus, safePath } from '../dist/services/blog-prs.js';
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'blog-pr-test-')); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, value) => { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  write('.shippostrc.json', {llm:{provider:'grok'},generation:{},blog:{pullRequests:{enabled:true}}});
  write('input/meeting.md', 'private notes');
  write('.shippost-state.json', {processedFiles:{[join(cwd,'input/meeting.md')]:{path:join(cwd,'input/meeting.md'),targets:{blog:{},revisions:{}}}}});
  write('src/content/drafts/new-essay.mdx', '---\ntitle: "A $& title"\nsource: input/meeting.md\nimage: /images/posts/new-essay.svg\ndraft: true\n---\nSee [related](/related).');
  write('public/images/posts/new-essay.svg', '<svg/>');
  return {cwd,write};
}
test('waits for revisions and packages all outputs from the same meeting', t => {
  const {cwd,write} = fixture(t);
  write('.shippost-revisions/proposal.json',{sourceFile:'input/meeting.md',originalPath:'src/content/posts/related.mdx',originalHash:'expected'});
  write('.shippost-revisions/proposal.mdx','---\ntitle: Related\n---\nRevised text');
  const [bundle] = collectBlogBundles(cwd);
  assert.deepEqual(bundle.newPosts,['new-essay']); assert.deepEqual(bundle.revisions,['src/content/posts/related.mdx']);
  assert.equal(Object.keys(bundle.files).length,3);
  assert.ok(!bundle.files['src/content/posts/new-essay.mdx'].includes('source:'));
  assert.ok(bundle.files['src/content/posts/new-essay.mdx'].includes('A $& title'));
  write('.shippost-state.json',{processedFiles:{[join(cwd,'input/meeting.md')]:{path:join(cwd,'input/meeting.md'),targets:{blog:{}}}}});
  assert.deepEqual(collectBlogBundles(cwd),[]);
});
test('places new essays beside a linked published essay and refuses guessing', t => {
  const {cwd} = fixture(t); const [b] = collectBlogBundles(cwd);
  assert.equal(addHomepagePosts('slugs: [\n  "related",\n]',b),'slugs: [\n  "related",\n  "new-essay",\n]');
  assert.throws(()=>addHomepagePosts('slugs: []',b),/Choose a homepage chapter/);
});
test('rejects traversal, escaping symlinks, and unsafe revision targets', t => {
  const {cwd,write} = fixture(t);
  assert.throws(()=>safePath(cwd,'../secret'));
  symlinkSync(tmpdir(),join(cwd,'outside')); assert.throws(()=>safePath(cwd,'outside/secret'));
  write('.shippost-revisions/proposal.json',{sourceFile:'input/meeting.md',originalPath:'.env'});
  write('.shippost-revisions/proposal.mdx','---\ntitle: Nope\n---\nNope');
  assert.throws(()=>collectBlogBundles(cwd),/invalid original path/);
});
test('refuses stale revisions before staging or validation', async t => {
  const {cwd,write}=fixture(t); const [b]=collectBlogBundles(cwd);
  write('src/content/posts/related.mdx','changed'); b.originalHashes['src/content/posts/related.mdx']='old hash';
  let calls=0; await assert.rejects(prepareBlogBundle(cwd,cwd,b,async()=>{calls++;return '';}),/Revision needs rebase/); assert.equal(calls,0);
});
test('runs lint before build and validation failure cannot publish', async t => {
  const {cwd,write}=fixture(t); const [b]=collectBlogBundles(cwd);
  rmSync(join(cwd,'public/images/posts/new-essay.svg'));
  write('src/lib/homepage-sections.ts','slugs: [\n "related",\n]');
  const calls=[];
  await assert.rejects(prepareBlogBundle(cwd,cwd,b,async(c,args)=>{calls.push([c,...args]);if(args[0]==='lint')throw Error('invalid MDX');return '';}),/invalid MDX/);
  assert.deepEqual(calls.map(c=>c.slice(0,2)),[['git','add'],['pnpm','install'],['pnpm','lint']]);
});
test('reconciles an existing PR once and never duplicates it on later polls', async t => {
  const {cwd}=fixture(t); let queries=0;
  const run=async(c,args)=>{if(c==='git')return 'https://github.com/ryw/rywalker.com.git';queries++;return '[{"url":"https://github.com/ryw/rywalker.com/pull/999"}]';};
  await processBlogPrs(cwd,{run}); await processBlogPrs(cwd,{run});
  assert.equal(queries,1); assert.equal(Object.values(readBlogPrStatus(cwd))[0].status,'opened');
});
test('failed preparation waits for an explicit retry without repeating model work', async t => {
  const {cwd}=fixture(t); let calls=0;const run=async()=>{calls++;throw Error('GitHub unavailable');};
  await processBlogPrs(cwd,{run});await processBlogPrs(cwd,{run});assert.equal(calls,1);
  await processBlogPrs(cwd,{run,retry:true});assert.equal(calls,2);
});
test('successful preparation stages only publication paths and validates before opening', async t => {
  const {cwd}=fixture(t); const calls=[];let opened=false;
  const run=async(c,args,dir)=>{
    calls.push([c,...args]);
    if(c==='git' && args[0]==='remote')return 'https://github.com/ryw/rywalker.com.git';
    if(c==='gh' && args[0]==='pr' && args[1]==='list')return opened?'[{"url":"https://github.com/ryw/rywalker.com/pull/998"}]':'[]';
    if(c==='git' && args[0]==='worktree' && args[1]==='add') {
      mkdirSync(join(args[3],'src/lib'),{recursive:true});
      writeFileSync(join(args[3],'src/lib/homepage-sections.ts'),'slugs: [\n "related",\n]');
    }
    if((c==='tembo'&&args[0]==='pull-request') || (c==='gh'&&args[1]==='create'))opened=true;
    return '';
  };
  await processBlogPrs(cwd,{run});
  assert.equal(Object.values(readBlogPrStatus(cwd))[0].status,'opened');
  const build=calls.findIndex(c=>c[0]==='pnpm'&&c[1]==='build');
  const commit=calls.findIndex(c=>c[1]==='commit');
  assert.ok(build>=0&&commit>build);
  const create = calls.find(c => (c[0] === 'tembo' && c[1] === 'pull-request') || (c[0] === 'gh' && c[2] === 'create'));
  assert.ok(create);
  assert.ok(!create.includes('--draft'), 'website PRs must be ready for review');
  const staged=calls.find(c=>c[0]==='git'&&c[1]==='add').slice(3);
  assert.deepEqual(staged.sort(),['public/images/posts/new-essay.svg','src/content/posts/new-essay.mdx','src/lib/homepage-sections.ts'].sort());
});
test('the generated page script remains valid JavaScript', async () => {
  const {PAGE}=await import('../dist/commands/ui/page.js');
  assert.doesNotThrow(()=>new Function(PAGE.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
test('panel hides merged/closed PRs without deleting history and caches GitHub polling', async t => {
  const {createBlogPrPanel}=await import('../dist/services/blog-prs.js');
  const {cwd,write}=fixture(t);const url='https://github.com/ryw/rywalker.com/pull/998';
  write('.shippost-blog-prs.json',{a:{status:'opened',url},b:{status:'opened',url:'https://github.com/ryw/rywalker.com/pull/997'},c:{status:'preparing'}});
  let time=0,calls=0,output=url;
  const panel=createBlogPrPanel(cwd,async()=>{calls++;return output;},()=>time);
  assert.deepEqual((await panel()).map(r=>r.status),['opened','preparing']);
  await Promise.all([panel(),panel()]);assert.equal(calls,1);
  time=60_001;output='';assert.deepEqual((await panel()).map(r=>r.status),['preparing']);
  assert.equal(Object.keys(readBlogPrStatus(cwd)).length,3);
});
test('panel retains last known statuses when GitHub is unavailable', async t => {
  const {createBlogPrPanel}=await import('../dist/services/blog-prs.js');
  const {cwd,write}=fixture(t);write('.shippost-blog-prs.json',{a:{status:'opened',url:'https://github.com/ryw/rywalker.com/pull/998'}});
  let time=0;const panel=createBlogPrPanel(cwd,async()=>{if(time)throw Error('offline');return '';},()=>time);
  assert.deepEqual(await panel(),[]);time=60_001;assert.deepEqual(await panel(),[]);
});
test('running or failed rechecks block publication until completed', t => {
  const {cwd,write}=fixture(t);
  for (const status of ['running','failed']) {
    write('.shippost-revisions/abc.run.json',{sourceFile:'input/meeting.md',status});
    assert.deepEqual(collectBlogBundles(cwd),[]);
  }
  write('.shippost-revisions/abc.run.json',{sourceFile:'input/meeting.md',status:'completed'});
  assert.equal(collectBlogBundles(cwd).length,1);
});
test('late revisions open one follow-up and original bundled revisions never duplicate', async t => {
  const {cwd,write}=fixture(t); let queries=0;
  const run=async(c,args)=>{
    if(c==='git')return 'https://github.com/ryw/rywalker.com.git';
    queries++;return JSON.stringify([{url:`https://github.com/ryw/rywalker.com/pull/${900+queries}`}]);
  };
  await processBlogPrs(cwd,{run});
  write('.shippost-revisions/proposal.json',{sourceFile:'input/meeting.md',originalPath:'src/content/posts/related.mdx',originalHash:'expected'});
  write('.shippost-revisions/proposal.mdx','---\ntitle: Related\n---\nRevised text');
  await processBlogPrs(cwd,{run}); await processBlogPrs(cwd,{run});
  assert.equal(queries,2);
  assert.equal(Object.values(readBlogPrStatus(cwd)).length,2);
  assert.ok(Object.keys(readBlogPrStatus(cwd)).some(id=>id.includes('-r-')));
  write('.shippost-blog-prs.json',{});queries=0;
  await processBlogPrs(cwd,{run}); await processBlogPrs(cwd,{run});
  assert.equal(queries,1);
});
