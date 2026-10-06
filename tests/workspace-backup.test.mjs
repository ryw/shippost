import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureWorkspace,restoreWorkspace,WorkspaceBackup,startWorkspaceBackup} from '../dist/services/workspace-backup.js';
function fixture(t) {const cwd=mkdtempSync(join(tmpdir(),'backup-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
function write(cwd,path,value){mkdirSync(join(cwd,path,'..'),{recursive:true});writeFileSync(join(cwd,path),typeof value==='string'?value:JSON.stringify(value));}
class Remote {
 refs=new Map(); objects=new Map(); private=true; next=0; failPush=false;
 verify(){if(!this.private)throw Error('private repo required');}
 head(ref){return this.refs.get(ref)||null;}
 base(){return 'base';}
 commit(parent,content){const sha='commit-'+ ++this.next;this.objects.set(sha,{parent,content});return sha;}
 create(ref,sha){if(this.refs.has(ref))throw Error('ref already owned');this.refs.set(ref,sha);}
 advance(ref,sha){if(this.failPush)throw Error('offline');if(this.objects.get(sha).parent!==this.head(ref))throw Error('non-fast-forward');this.refs.set(ref,sha);}
 remove(ref){this.refs.delete(ref);}
 read(sha){return JSON.parse(this.objects.get(sha).content);}
}
test('snapshot includes content and review state but excludes keys, auth, locks, code, and unknown config fields',t=>{
 const cwd=fixture(t);write(cwd,'.shippostrc.json',{anthropic:{apiKey:'SECRET',model:'m'},unknown:'SECRET',blog:{pullRequests:{enabled:true,secret:'SECRET'}}});
 for(const p of ['.env','.shippost-secrets.json','.shippost-grok/subscription.json','.shippost-backup-local.json','src/index.ts'])write(cwd,p,'SECRET');
 for(const p of ['input/meeting.md','prompts/style.md','src/content/drafts/essay.mdx','public/images/posts/essay.svg','.shippost-revisions/a.mdx'])write(cwd,p,'content');
 write(cwd,'posts.jsonl',JSON.stringify({id:'x',sourceFile:join(cwd,'input/meeting.md'),metadata:{typefullyDraftId:'42'},status:'staged'})+'\n');
 const snapshot=captureWorkspace(cwd);assert.ok(!JSON.stringify(snapshot).includes('SECRET'));assert.equal(Object.keys(snapshot.files).length,7);
 assert.equal(JSON.parse(snapshot.files['posts.jsonl'].content).metadata.typefullyDraftId,'42');assert.ok(!snapshot.files['posts.jsonl'].content.includes(cwd));
});
test('restores target tracking at a different root and removes old worker PIDs',t=>{
 const a=fixture(t),b=fixture(t);write(a,'input/meeting.md','notes');write(a,'.shippost-state.json',{processedFiles:{[join(a,'input/meeting.md')]:{path:join(a,'input/meeting.md'),targets:{social:{postsGenerated:8}}}}});
 write(a,'.shippost-generation-queue.json',{version:1,queue:[],active:{file:'meeting.md',target:'blog',pid:999}});
 restoreWorkspace(b,captureWorkspace(a));const state=JSON.parse(readFileSync(join(b,'.shippost-state.json')));assert.ok(state.processedFiles[join(b,'input/meeting.md')].targets.social);
 assert.equal(JSON.parse(readFileSync(join(b,'.shippost-generation-queue.json'))).active.pid,undefined);assert.equal(captureWorkspace(a).digest,captureWorkspace(b).digest);
});
test('refuses unsafe paths, symlinks, invalid hashes and local overwrite before restoring any files',t=>{
 const a=fixture(t),b=fixture(t);write(a,'input/a.md','one');write(a,'input/b.md','two');write(b,'input/b.md','local');
 assert.throws(()=>restoreWorkspace(b,captureWorkspace(a)),/overwrite/);assert.equal(existsSync(join(b,'input/a.md')),false);
 const snapshot=captureWorkspace(a);snapshot.files['../escape']={content:'bad',mtime:1};assert.throws(()=>restoreWorkspace(b,snapshot),/Invalid/);
 symlinkSync(tmpdir(),join(a,'input/outside'));assert.throws(()=>captureWorkspace(a),/symlink/);
});
test('private remote lock prevents two writers; explicit release allows portable restoration',t=>{
 const a=fixture(t),b=fixture(t),remote=new Remote();write(a,'input/meeting.md','notes');
 const first=new WorkspaceBackup(a,remote),second=new WorkspaceBackup(b,remote);first.start();first.checkpoint();const count=remote.next;first.checkpoint();assert.equal(remote.next,count);
 assert.throws(()=>second.start(),/owns/);first.release();assert.throws(()=>first.assertWriter(),/released/);
 second.start();assert.equal(readFileSync(join(b,'input/meeting.md'),'utf8'),'notes');second.checkpoint();assert.throws(()=>first.assertWriter(),/released/);
});
test('failed checkpoint preserves last successful remote and can retry; public repos are rejected',t=>{
 const cwd=fixture(t),remote=new Remote(),backup=new WorkspaceBackup(cwd,remote);write(cwd,'input/a.md','old');backup.start();backup.checkpoint();const before=remote.head('tembo/shippost-state');
 write(cwd,'input/a.md','new');remote.failPush=true;assert.throws(()=>backup.checkpoint(),/offline/);assert.equal(remote.head('tembo/shippost-state'),before);
 remote.failPush=false;backup.checkpoint();assert.notEqual(remote.head('tembo/shippost-state'),before);
 remote.private=false;assert.throws(()=>backup.checkpoint(),/private/);
});
test('missing backing repository blocks startup',t=>{assert.throws(()=>startWorkspaceBackup(fixture(t)),/required/);});
test('lost writer ownership blocks further checkpoints',t=>{
 const cwd=fixture(t),remote=new Remote(),backup=new WorkspaceBackup(cwd,remote);backup.start();remote.refs.set('tembo/shippost-writer','other');assert.throws(()=>backup.checkpoint(),/writer lock/);
});
test('resumes an interrupted restore before permitting work',t=>{
 const a=fixture(t),b=fixture(t),remote=new Remote(),first=new WorkspaceBackup(a,remote);write(a,'input/a.md','A');write(a,'input/b.md','B');first.start();first.checkpoint();first.release();
 const snapshot=remote.read(remote.head('tembo/shippost-state'));
 write(b,'.shippost-backup-restore.json',snapshot);write(b,'input/a.md','A');
 new WorkspaceBackup(b,remote).start();assert.equal(readFileSync(join(b,'input/b.md'),'utf8'),'B');assert.equal(existsSync(join(b,'.shippost-backup-restore.json')),false);
});
test('adopts a successfully pushed checkpoint if the process died before saving its local acknowledgement',t=>{
 const cwd=fixture(t),remote=new Remote(),backup=new WorkspaceBackup(cwd,remote);write(cwd,'input/a.md','A');backup.start();backup.checkpoint();const local=readFileSync(join(cwd,'.shippost-backup-local.json'),'utf8');
 write(cwd,'input/a.md','B');backup.checkpoint();writeFileSync(join(cwd,'.shippost-backup-local.json'),local);backup.start();backup.checkpoint();assert.equal(remote.read(remote.head('tembo/shippost-state')).files['input/a.md'].content,'B');
});
test('rejects dangling symlinks and unsupported output layouts rather than omitting data',t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'input'));symlinkSync('/nonexistent-target-for-backup',join(cwd,'input/a.md'));assert.throws(()=>captureWorkspace(cwd),/symlink/);
 rmSync(join(cwd,'input/a.md'));write(cwd,'.shippostrc.json',{blog:{outputDir:'custom'}});assert.throws(()=>captureWorkspace(cwd),/standard/);
});
test('GitHub adapter uses valid repo endpoint and non-forced ref updates',async t=>{
 const cp=(await import('node:child_process')).default;const {syncBuiltinESMExports}=await import('node:module');const original=cp.execFileSync;
 const calls=[];cp.execFileSync=(cmd,args,options)=>{calls.push({cmd,args,body:options.input?JSON.parse(options.input):null});assert.equal(cmd,'gh');
   if(args[1]==='repos/owner/site')return JSON.stringify({private:true,default_branch:'main'});
   if(args[1]==='repos/owner/site/git/ref/heads/main')return JSON.stringify({object:{sha:'base'}});
   if(args[1]==='repos/owner/site/git/refs/heads/tembo/shippost-state')return JSON.stringify({object:{sha:'new'}});
   throw Error('Unexpected API endpoint');
 };syncBuiltinESMExports();t.after(()=>{cp.execFileSync=original;syncBuiltinESMExports();});
 const {GitHubBackupRemote}=await import('../dist/services/workspace-backup.js');const remote=new GitHubBackupRemote('owner/site');remote.verify();assert.equal(remote.base(),'base');remote.advance('tembo/shippost-state','new');
 assert.deepEqual(calls.at(-1).body,{sha:'new',force:false});assert.ok(calls.at(-1).args.includes('PATCH'));
});
