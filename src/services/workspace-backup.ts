import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, readdirSync, lstatSync, utimesSync, rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const STATE = 'tembo/shippost-state', WRITER = 'tembo/shippost-writer';
const configFile = '.shippost-backup.json', localFile = '.shippost-backup-local.json';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const roots = ['input', 'prompts', 'src/content/drafts', 'public/images/posts', '.shippost-revisions'];
const singles = ['posts.jsonl', 'strategies.json', '.shippostrc.json', '.shippost-state.json', '.shippost-generation-queue.json', '.shippost-transcript-meta.json', '.shippost-blog-prs.json', '.granola-sync-state.json', '.shippost-grok/requests.jsonl', '.shippost-metrics/events.jsonl'];
interface Entry { content: string; mtime: number }
export interface Snapshot { version: 1; files: Record<string, Entry>; digest: string }
interface Local { writer?: string; digest?: string; checkpoint?: string; updatedAt?: string; error?: string; paused?: boolean }
export interface BackupRemote {
  verify(): void;
  head(ref: string): string | null;
  base(): string;
  commit(parent: string, content: string, message: string): string;
  create(ref: string, sha: string): void;
  advance(ref: string, sha: string): void;
  remove(ref: string): void;
  read(sha: string): Snapshot;
}
function json(path: string, fallback: any = {}) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; }
function atomic(path: string, data: unknown) {
  safe(dirname(path), join('.', path.split('/').pop()!));
  const tmp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(tmp, path); }
  finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
function safe(cwd: string, path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..') || path.includes('\\') || path.includes('\0')) throw Error('Unsafe backup path');
  const full = resolve(cwd, path);
  let part = resolve(cwd);
  if (lstatSync(part).isSymbolicLink()) throw Error('Backup workspace cannot be a symlink');
  for (const name of relative(cwd, full).split('/').filter(Boolean)) {
    part = join(part, name);
    try { if(lstatSync(part).isSymbolicLink())throw Error('Backup paths cannot contain symlinks'); } catch(error:any) { if(error.code!=='ENOENT')throw error; }
  }
  return full;
}
function allowed(path: string) {
  return singles.includes(path) || roots.some(root => path.startsWith(root + '/') && /\.(md|mdx|txt|svg|json)$/.test(path) && !path.split('/').some(p => p.startsWith('.') && p !== '.shippost-revisions'));
}
function configWithoutSecrets(value: any): any {
  // Explicit configuration schema: never copy arbitrary unknown keys or inline credentials.
  const schema: Record<string, string[]> = {
    llm:['provider'], ollama:['host','model','timeout'], anthropic:['model','maxTokens'], grok:['model','reasoningEffort'],
    generation:['postsPerTranscript','temperature','strategies'], typefully:['socialSetId'], x:['enabled','clientId','apiTier'],
    blog:['outputDir','imageDir','imagePathPrefix','pullRequests'],
  };
  const result: any = {};
  for (const [group, keys] of Object.entries(schema)) if (value[group]) {
    result[group] = {};
    for (const key of keys) if (value[group][key] !== undefined) result[group][key] = value[group][key];
  }
  if (result.generation?.strategies) result.generation.strategies = Object.fromEntries(['enabled','autoSelect','diversityWeight','preferThreadFriendly'].filter(k=>value.generation.strategies[k] !== undefined).map(k=>[k,value.generation.strategies[k]]));
  if (result.blog?.pullRequests) result.blog.pullRequests = Object.fromEntries(['enabled','repository','baseBranch'].filter(k=>value.blog.pullRequests[k] !== undefined).map(k=>[k,value.blog.pullRequests[k]]));
  if (result.ollama?.host) { const u = new URL(result.ollama.host); if(u.username || u.password || u.search) throw Error('Remove credentials/query parameters from the Ollama URL before backup'); }
  return result;
}
function portable(cwd: string, path: string, content: string, restoring = false): string {
  const move = (p: string) => {
    if (restoring) { safe(cwd,p); return resolve(cwd,p); }
    const r = isAbsolute(p) ? relative(cwd,p) : p; safe(cwd,r); return r;
  };
  if (path === '.shippostrc.json') return JSON.stringify(configWithoutSecrets(JSON.parse(content)));
  if (path === '.shippost-state.json') {
    const state = JSON.parse(content); const files: any = {};
    for (const [key, info] of Object.entries(state.processedFiles || {}) as [string,any][]) {
      const p=move(info.path || key); files[p]={...info,path:p};
    }
    return JSON.stringify({...state,processedFiles:files});
  }
  if (path === '.shippost-generation-queue.json') {
    const data=JSON.parse(content); for (const item of [...(data.queue || []), data.active].filter(Boolean)) delete item.pid;
    return JSON.stringify(data);
  }
  if (path === 'posts.jsonl') return content.split('\n').filter(Boolean).map(line=>{const p=JSON.parse(line); if(p.sourceFile) p.sourceFile=restoring ? p.sourceFile : move(p.sourceFile); return JSON.stringify(p);}).join('\n')+'\n';
  return content;
}
export function captureWorkspace(cwd: string): Snapshot {
  const config = json(join(cwd,'.shippostrc.json'));
  if ((config.blog?.outputDir && config.blog.outputDir !== 'src/content/drafts') || (config.blog?.imageDir && config.blog.imageDir !== 'public/images/posts')) throw Error('Backup currently requires the standard draft and image directories');
  const paths = new Set<string>(singles.filter(p=>existsSync(join(cwd,p))));
  function walk(path: string) {
    const full=safe(cwd,path); if(!existsSync(full))return;
    for(const name of readdirSync(full)) { const p=path+'/'+name, file=safe(cwd,p); if(lstatSync(file).isDirectory()) walk(p); else if(allowed(p))paths.add(p); }
  }
  for(const root of roots)walk(root);
  const files: Record<string,Entry>={};
  for(const path of [...paths].sort()) {
    const full=safe(cwd,path); const content=portable(cwd,path,readFileSync(full,'utf8'));
    files[path]={content,mtime:lstatSync(full).mtimeMs};
  }
  const digest=hash(JSON.stringify(Object.fromEntries(Object.entries(files).map(([p,e])=>[p,e.content]))));
  if(Buffer.byteLength(JSON.stringify(files))>40*1024*1024)throw Error('Backup exceeds the 40 MB snapshot limit');
  return {version:1,files,digest};
}
export function restoreWorkspace(cwd: string, snapshot: Snapshot, resume = false) {
  if(snapshot.version!==1 || !snapshot.files || snapshot.digest!==hash(JSON.stringify(Object.fromEntries(Object.entries(snapshot.files).map(([p,e])=>[p,e.content])))))throw Error('Invalid backup snapshot');
  for(const [path,entry] of Object.entries(snapshot.files)) {
    if(!allowed(path) || typeof entry.content!=='string' || !Number.isFinite(entry.mtime))throw Error('Invalid backup entry');
    const full=safe(cwd,path);
    portable(cwd,path,entry.content,true); // Validate the entire snapshot before writing anything.
    if(!resume && existsSync(full) && readFileSync(full,'utf8')!==entry.content) {
      // A fresh code checkout can contain baseline tracked files. Only overwrite clean tracked copies.
      try { execFileSync('git',['ls-files','--error-unmatch',path],{cwd,stdio:'ignore'}); execFileSync('git',['diff','--quiet','HEAD','--',path],{cwd,stdio:'ignore'}); }
      catch { throw Error(`Restore would overwrite local changes: ${path}. Use a fresh workspace.`); }
    }
  }
  atomic(join(cwd,'.shippost-backup-restore.json'),snapshot);
  for(const [path,entry] of Object.entries(snapshot.files)) {
    const full=safe(cwd,path); mkdirSync(dirname(full),{recursive:true});
    const temp=full+'.restore.tmp'; safe(cwd,relative(cwd,temp));
    writeFileSync(temp,portable(cwd,path,entry.content,true),{mode:0o600}); renameSync(temp,full); utimesSync(full,new Date(entry.mtime),new Date(entry.mtime));
  }
  for(const dir of ['.shippost-grok','.shippost-metrics']) if(existsSync(join(cwd,dir)))writeFileSync(safe(cwd,dir+'/.gitignore'),'*\n',{mode:0o600});
  unlinkSync(join(cwd,'.shippost-backup-restore.json'));
}
export class GitHubBackupRemote implements BackupRemote {
  constructor(readonly repository: string) { if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw Error('Enter a GitHub repository as owner/name'); }
  private api(path: string, body?: unknown, method?: string): any {
    try {
      const args=['api',`repos/${this.repository}${path ? "/" + path : ""}`];
      if(body!==undefined)args.push('--input','-'); if(method)args.push('--method',method);
      const output=execFileSync('gh',args,{encoding:'utf8',input:body===undefined?undefined:JSON.stringify(body),stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:80*1024*1024});
      return output.trim()?JSON.parse(output):null;
    } catch(error:any) { if(String(error.stderr).includes('HTTP 404'))return null; throw Error('GitHub backup request failed. Check authentication, access, and network.'); }
  }
  verify() { const repo=this.api(''); if(!repo?.private || repo.archived)throw Error('Backup requires a private, writable GitHub repository'); }
  head(ref:string) { return this.api('git/ref/heads/'+ref)?.object?.sha || null; }
  base() { const repo=this.api(''); const sha=this.head(repo?.default_branch); if(!sha)throw Error('Initialize the private backup repository with a README first'); return sha; }
  commit(parent:string,content:string,message:string) {
    const blob=this.api('git/blobs',{content,encoding:'utf-8'}); if(!blob?.sha)throw Error('Could not create backup blob');
    const tree=this.api('git/trees',{tree:[{path:'snapshot.json',mode:'100644',type:'blob',sha:blob.sha}]});
    const commit=this.api('git/commits',{message,tree:tree.sha,parents:[parent]}); if(!commit?.sha)throw Error('Could not create backup commit'); return commit.sha;
  }
  create(ref:string,sha:string) { if(!this.api('git/refs',{ref:'refs/heads/'+ref,sha}))throw Error('Could not acquire backup reference'); }
  advance(ref:string,sha:string) { if(!this.api('git/refs/heads/'+ref,{sha,force:false},'PATCH'))throw Error('Backup changed remotely; reload before retrying'); }
  remove(ref:string) { this.api('git/refs/heads/'+ref,undefined,'DELETE'); }
  read(sha:string) {
    const commit=this.api('git/commits/'+sha),tree=this.api('git/trees/'+commit.tree.sha);
    const file=tree.tree.find((e:any)=>e.path==='snapshot.json' && e.type==='blob'); if(!file)throw Error('Backup branch has no snapshot');
    const blob=this.api('git/blobs/'+file.sha); if(!blob?.content)throw Error('Could not read backup snapshot');
    return JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));
  }
}
export function backupRepository(cwd:string): string | undefined { return process.env.SHIPPOST_STATE_REPOSITORY || json(join(cwd,configFile)).repository; }
export class WorkspaceBackup {
  constructor(readonly cwd:string,readonly remote:BackupRemote) {}
  private local():Local { return json(join(this.cwd,localFile)); }
  private save(local:Local) { atomic(join(this.cwd,localFile),local); }
  assertWriter() {
    const local=this.local(); if(local.paused)throw Error('Workspace released. Restart or reconnect before processing.');
    this.remote.verify(); if(!local.writer || this.remote.head(WRITER)!==local.writer)throw Error('This workspace does not hold the backup writer lock. Stop the other VM before handoff.');
  }
  start() {
    this.remote.verify(); let local=this.local(); if(local.paused)throw Error('Workspace released. Reconnect backups to resume.');
    const owner=this.remote.head(WRITER);
    if(owner && owner!==local.writer)throw Error('Another workspace owns this backup. Stop it and release its writer lock first.');
    if(!owner) {
      const base=this.remote.head(STATE) || this.remote.base();
      const writer=this.remote.commit(base,JSON.stringify({writer:randomUUID()}),'Claim Shippost workspace writer');
      this.save({...local,writer}); this.remote.create(WRITER,writer); local=this.local();
    }
    this.assertWriter();
    const head=this.remote.head(STATE);
    const pending=join(this.cwd,'.shippost-backup-restore.json');
    const resumed=existsSync(pending);
    if(resumed) { restoreWorkspace(this.cwd,json(pending),true); this.save({...local,checkpoint:head || undefined,digest:captureWorkspace(this.cwd).digest,updatedAt:new Date().toISOString()}); local=this.local(); }
    if(head && !local.checkpoint) { restoreWorkspace(this.cwd,this.remote.read(head)); this.save({...local,checkpoint:head,digest:captureWorkspace(this.cwd).digest,updatedAt:new Date().toISOString()}); }
    else if(head && head!==local.checkpoint) {
      if(this.remote.read(head).digest===captureWorkspace(this.cwd).digest)this.save({...local,checkpoint:head,digest:captureWorkspace(this.cwd).digest});
      else throw Error('Remote checkpoint changed. Preserve local changes and restore into a fresh workspace.');
    }
  }
  checkpoint() {
    this.assertWriter(); const local=this.local();
    const snapshot=captureWorkspace(this.cwd);
    if(captureWorkspace(this.cwd).digest!==snapshot.digest)throw Error('Workspace changed during backup; retrying at the next checkpoint');
    if(snapshot.digest===local.digest)return;
    const head=this.remote.head(STATE); if(head && head!==local.checkpoint)throw Error('Remote checkpoint changed; refusing to overwrite it');
    const commit=this.remote.commit(head || this.remote.base(),JSON.stringify(snapshot),'Checkpoint Shippost workspace');
    this.assertWriter(); if(head)this.remote.advance(STATE,commit);else this.remote.create(STATE,commit);
    this.save({...local,checkpoint:commit,digest:snapshot.digest,updatedAt:new Date().toISOString(),error:undefined});
  }
  release() { this.checkpoint(); this.assertWriter(); this.remote.remove(WRITER); this.save({...this.local(),paused:true}); }
}
function service(cwd:string) { const repository=backupRepository(cwd); return repository?new WorkspaceBackup(cwd,new GitHubBackupRemote(repository)):undefined; }
export function assertBackupWriter(cwd:string) { service(cwd)?.assertWriter(); }
export function checkpointWorkspace(cwd:string) {
  const backup=service(cwd); if(!backup)return;
  // All local processes share this lock; remote ref updates still reject cross-machine conflicts.
  const lock=join(cwd,'.shippost-backup.lock');
  const deadline=Date.now()+10000;
  for (;;) {
    try {mkdirSync(lock);break;} catch(error:any) {if(error.code!=='EEXIST')throw error;}
    try {process.kill(Number(readFileSync(join(lock,'pid'),'utf8')),0);}
    catch(error:any) {if(error.code==='ESRCH'){rmSync(lock,{recursive:true});continue;}if(error.code!=='ENOENT')throw Error('Backup lock needs inspection');}
    if(Date.now()>=deadline)throw Error('Another local checkpoint is running; retry shortly');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  }
  writeFileSync(join(lock,'pid'),String(process.pid));
  try { backup.checkpoint(); }
  catch(error) { atomic(join(cwd,localFile),{...json(join(cwd,localFile)),error:(error as Error).message}); throw error; }
  finally {rmSync(lock,{recursive:true});}
}
export function startWorkspaceBackup(cwd:string) { const backup=service(cwd); if(!backup)throw Error('A private state repository is required. Connect it in Settings or run ship backup --repository owner/name.'); backup.start(); }
export function configureWorkspaceBackup(cwd:string,repository:string) {
  const old=backupRepository(cwd); if(old && old!==repository)throw Error('Use a fresh workspace to connect a different backup repository');
  const remote=new GitHubBackupRemote(repository);remote.verify();
  atomic(join(cwd,configFile),{repository});
  const local=json(join(cwd,localFile)); if(local.paused)atomic(join(cwd,localFile),{...local,paused:false});
  startWorkspaceBackup(cwd);checkpointWorkspace(cwd);
}
export function releaseWorkspaceBackup(cwd:string) { service(cwd)?.release(); }
export function backupStatus(cwd:string) {
  const local:Local=json(join(cwd,localFile));
  let suggestedRepository=''; try { const origin=execFileSync('git',['remote','get-url','origin'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); suggestedRepository=origin.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] || ''; } catch {}
  return {repository:backupRepository(cwd) || '',suggestedRepository,checkpoint:local.checkpoint || null,updatedAt:local.updatedAt || null,error:local.error || null,paused:!!local.paused};
}
