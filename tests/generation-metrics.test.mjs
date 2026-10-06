import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, appendFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {instrumentLLM, reportModelMetrics, beginGenerationRun, readGenerationMetrics, summarizeMetrics} from '../dist/services/generation-metrics.js';

test('records correlated steps and real usage without storing content or errors', async t => {
  const cwd=mkdtempSync(join(tmpdir(),'metrics-')); t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const finish=beginGenerationRun(cwd,'input/example.md','social');
  const service=instrumentLLM({getModelName:()=> 'model',getTemperature:()=>undefined,isAvailable:async()=>true,ensureAvailable:async()=>{},generate:async()=>{
    reportModelMetrics({inputTokens:100,outputTokens:30,cachedInputTokens:50,reasoningTokens:20,authMs:1,prompt:'secret'});
    return 'private output';
  }},'grok',cwd);
  assert.equal(await service.generate('private input','social-draft'),'private output');
  finish('completed');
  const data=readGenerationMetrics(cwd); assert.equal(data.sampleSize,1);assert.equal(data.runs[0].calls,1);
  assert.equal(data.purposes[0].inputTokens,100);assert.equal(data.purposes[0].reasoningTokens,20);
  assert.equal(data.active.length,0);assert.ok(data.runs[0].outsideModelMs>=0);
  const path=join(cwd,'.shippost-metrics/events.jsonl'),raw=readFileSync(path,'utf8');
  for(const text of ['private input','private output','secret'])assert.ok(!raw.includes(text));
  assert.equal(statSync(path).mode&0o777,0o600);
  appendFileSync(path,'{"incomplete":');assert.equal(readGenerationMetrics(cwd).sampleSize,1);
});
test('exceptions preserve failures with unknown tokens instead of fabricated zero usage',async t=>{
  const cwd=mkdtempSync(join(tmpdir(),'metrics-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const service=instrumentLLM({getModelName:()=> 'model',generate:async()=>{throw Error('private upstream body');}},'grok',cwd);
  await assert.rejects(service.generate('secret'),/private upstream body/);
  const data=readGenerationMetrics(cwd);assert.equal(data.purposes[0].failures,1);assert.equal(data.purposes[0].inputTokens,null);
  assert.ok(!readFileSync(join(cwd,'.shippost-metrics/events.jsonl'),'utf8').includes('private upstream body'));
});
test('aggregates latency, duplicate prompts, unknown usage and legacy logs without double counting',()=>{
  const base={kind:'request-end',provider:'grok',model:'m',purpose:'social-draft',startedAt:'2026-10-06T00:00:00Z',inputHash:'same',outcome:'completed'};
  const data=summarizeMetrics([{...base,elapsedMs:100,inputTokens:20,outputTokens:10},{...base,elapsedMs:300,outcome:'timeout'}],[{...base,instrumented:true,elapsedMs:100}],Date.now());
  assert.equal(data.sampleSize,2);const p=data.purposes[0];assert.equal(p.medianMs,200);assert.equal(p.p95Ms,300);assert.equal(p.repeatedPrompts,1);assert.equal(p.usageCalls,1);assert.equal(p.inputTokens,20);
});
test('shows ongoing requests and distinguishes interrupted processes',()=>{
  const events=[{kind:'request-start',requestId:'a',pid:1,startedAt:'2026-10-06T00:00:00Z',purpose:'blog-cover'}, {kind:'request-start',requestId:'b',pid:2,startedAt:'2026-10-06T00:00:00Z',purpose:'blog-draft'}];
  const d=summarizeMetrics(events,[],Date.parse('2026-10-06T00:01:00Z'),pid=>pid===1);
  assert.deepEqual(d.active.map(r=>r.status),['running','interrupted']);assert.equal(d.active[0].elapsedMs,60000);
});
test('concurrent calls retain their own token measurements',async t=>{
  const cwd=mkdtempSync(join(tmpdir(),'metrics-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const service=instrumentLLM({getModelName:()=> 'model',generate:async prompt=>{await new Promise(r=>setTimeout(r,prompt==='a'?10:1));reportModelMetrics({inputTokens:prompt==='a'?10:20});return 'ok';}},'grok',cwd);
  await Promise.all([service.generate('a','social-draft'),service.generate('b','blog-draft')]);
  const d=readGenerationMetrics(cwd);assert.equal(d.purposes.find(r=>r.purpose==='social-draft').inputTokens,10);assert.equal(d.purposes.find(r=>r.purpose==='blog-draft').inputTokens,20);
});
