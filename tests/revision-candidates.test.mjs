import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {revisionCatalog,discoverRevisionCandidates} from '../dist/services/revision-candidates.js';
test('discovery covers older essays across the entire library and excludes same-meeting drafts promoted to posts',async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'revision-catalog-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));const posts=join(cwd,'posts'),drafts=join(cwd,'drafts');mkdirSync(posts);mkdirSync(drafts);
 for(let i=0;i<12;i++){const file=join(posts,`essay-${String(i).padStart(2,'0')}.mdx`);writeFileSync(file,`---\ntitle: Essay ${i}\ndescription: >-\n  Concrete argument ${i}.\n---\nFull argument ${i}`);utimesSync(file,new Date(2000+i,0,1),new Date(2000+i,0,1));}
 writeFileSync(join(drafts,'essay-11.mdx'),'---\nsource: input/meeting.md\n---\nSame meeting');
 const catalog=revisionCatalog(posts,drafts,'input/meeting.md');assert.equal(catalog.length,11);assert.equal(catalog[0].description,'Concrete argument 0.');
 let calls=0;const selected=await discoverRevisionCandidates({generate:async(prompt,purpose)=>{calls++;assert.equal(purpose,'revision-discovery');const records=JSON.parse(prompt);assert.equal(records.length,11);assert.ok(records.some(r=>r.title==='Essay 0'));return '{"articles":[{"id":"0","reason":"The old argument needs clarification"}]}';}},catalog,'Meeting','{{articles}}');
 assert.equal(calls,1);assert.equal(selected[0].name,'essay-00.mdx');assert.ok(readFileSync(selected[0].path,'utf8').includes('Full argument 0'));
});
test('small libraries avoid an unnecessary catalog call; invalid selections fail closed',async()=>{
 const catalog=Array.from({length:10},(_,i)=>({name:String(i),path:String(i),title:String(i),description:'Summary'}));
 assert.deepEqual(await discoverRevisionCandidates({generate:async()=>{throw Error('extra call');}},catalog.slice(0,3),'',''),catalog.slice(0,3));
 for(const articles of [[{id:'10',reason:'invalid'}],[{id:'0',reason:''}],Array.from({length:9},(_,i)=>({id:String(i),reason:'too many'}))]) await assert.rejects(discoverRevisionCandidates({generate:async()=>JSON.stringify({articles})},catalog,'','{{articles}}'));
});
