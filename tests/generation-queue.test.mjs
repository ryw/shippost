import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {loadGenerationQueue,saveGenerationQueue,recoverGenerationQueue} from '../dist/services/generation-queue.js';
import {FileSystemService} from '../dist/services/file-system.js';
import {DEFAULT_CONFIG} from '../dist/types/config.js';
const ui=new URL('../dist/commands/ui/index.js',import.meta.url).href;
const fsModule=new URL('../dist/services/file-system.js',import.meta.url).href;
function fixture(t){const cwd=mkdtempSync(join(tmpdir(),'ship-recovery-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'input'));mkdirSync(join(cwd,'prompts'));for(const name of ['style','work'])writeFileSync(join(cwd,'prompts',name+'.md'),'Synthetic prompt');writeFileSync(join(cwd,'input/meeting.md'),'Synthetic notes');writeFileSync(join(cwd,'posts.jsonl'),'');writeFileSync(join(cwd,'.shippostrc.json'),JSON.stringify({...DEFAULT_CONFIG,x:{enabled:false}}));return cwd;}
test('atomic snapshot recovers active first, preserves target order, deduplicates',t=>{const cwd=fixture(t);const a={file:'meeting.md',target:'social'},b={file:'meeting.md',target:'blog'};saveGenerationQueue(cwd,[a,b],a);assert.deepEqual(recoverGenerationQueue(loadGenerationQueue(cwd)),[a,b]);writeFileSync(join(cwd,'.shippost-generation-queue.json.abandoned.tmp'),'broken');assert.equal(loadGenerationQueue(cwd).queue.length,2);});
test('corrupt and unsafe queues fail without replacing saved data',t=>{const cwd=fixture(t);const path=join(cwd,'.shippost-generation-queue.json');for(const text of ['{',JSON.stringify({version:1,active:null,queue:[{file:'../private',target:'blog'}]})]){writeFileSync(path,text);assert.throws(()=>loadGenerationQueue(cwd));assert.equal(readFileSync(path,'utf8'),text);}});
for (const completed of [false,true]) test('UI startup recovers interrupted work (completed checkpoint: '+completed+')',async t=>{
 const cwd=fixture(t);const fs=new FileSystemService(cwd);if(completed)fs.saveState(fs.markFileProcessed(join(cwd,'input/meeting.md'),1,fs.loadState(),'social'));
 saveGenerationQueue(cwd,[{file:'meeting.md',target:'blog'},{file:'meeting.md',target:'revisions'}],{file:'meeting.md',target:'social'});
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['--input-type=module','-e',`
 import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {appendFileSync} from 'node:fs';import {FileSystemService} from ${JSON.stringify(fsModule)};import {uiCommand} from ${JSON.stringify(ui)};
 cp.spawn=(_exe,args)=>{const worker=new EventEmitter();worker.stdout=new EventEmitter();worker.stderr=new EventEmitter();const target=args[args.indexOf('--target')+1];setTimeout(()=>{appendFileSync('calls.txt',target+'\\n');const fs=new FileSystemService(process.cwd());fs.saveState(fs.markFileProcessed(process.cwd()+'/input/meeting.md',1,fs.loadState(),target));worker.emit('close',0);},20);return worker;};syncBuiltinESMExports();await uiCommand({port:${port}});
 `],{cwd,stdio:'ignore'});
 try{let status;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,30));try{status=await(await fetch(`http://127.0.0.1:${port}/api/generate/status`)).json();if(status.running===false)break;}catch{}}assert.equal(status?.running,false);assert.equal(status?.queued,0);assert.equal(readFileSync(join(cwd,'calls.txt'),'utf8'),(completed?'':'social\n')+'blog\nrevisions\n');assert.deepEqual(loadGenerationQueue(cwd),{version:1,queue:[],active:null});}
 finally{if(child.exitCode===null){child.kill();await once(child,'exit');}}
});
