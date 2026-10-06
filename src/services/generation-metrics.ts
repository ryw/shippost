import { assertBackupWriter } from './workspace-backup.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LLMService, LLMPurpose } from './llm-service.js';

type RecordData = Record<string, any>;
const requestContext = new AsyncLocalStorage<RecordData>();
let run: RecordData | undefined;
const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
function save(cwd: string, record: RecordData) {
  try {
    const dir = join(cwd, '.shippost-metrics');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, '.gitignore'), '*\n', { mode: 0o600 });
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch { /* Observability must not block saving content. */ }
}
/** Only numeric usage/timing and fixed outcome labels enter the current request. */
export function reportModelMetrics(values: RecordData) {
  const context = requestContext.getStore();
  if (!context) return;
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'authMs', 'responseHeadersMs', 'bodyMs', 'httpStatus']) {
    if (key in values) context[key] = finite(values[key]);
  }
  if (['completed','timeout','network-error','http-error','incomplete','empty'].includes(values.outcome)) context.outcome = values.outcome;
}
export function beginGenerationRun(cwd: string, source: string, target: string) {
  const current = { kind: 'run-start', runId: randomUUID(), pid: process.pid, source, target, startedAt: new Date().toISOString() };
  run = current;
  save(cwd, current);
  return (outcome: string) => {
    save(cwd, { ...current, kind: 'run-end', outcome, elapsedMs: Date.now() - Date.parse(current.startedAt) });
    if (run === current) run = undefined;
  };
}
export function instrumentLLM(service: LLMService, provider: string, cwd = process.cwd()): LLMService {
  return {
    isAvailable: () => service.isAvailable(), ensureAvailable: () => service.ensureAvailable(),
    getModelName: () => service.getModelName(), getTemperature: () => service.getTemperature(),
    async generate(prompt: string, purpose: LLMPurpose = 'unspecified') {
      assertBackupWriter(cwd);
      const started = Date.now();
      const record: RecordData = {
        runId: run?.runId, source: run?.source, target: run?.target, pid: process.pid,
        requestId: randomUUID(), kind: 'request-start', startedAt: new Date(started).toISOString(),
        provider, model: service.getModelName(), purpose, inputCharacters: prompt.length,
        inputHash: createHash('sha256').update(prompt).digest('hex'), outcome: 'error',
      };
      save(cwd, record);
      return requestContext.run(record, async () => {
        try {
          const text = await service.generate(prompt, purpose);
          assertBackupWriter(cwd);
          record.outputCharacters = text.length; record.outcome = 'completed';
          return text;
        } finally {
          record.kind = 'request-end'; record.elapsedMs = Date.now() - started;
          save(cwd, record);
          const tokens = finite(record.inputTokens) === null ? 'tokens unavailable' : `${record.inputTokens} in / ${record.outputTokens ?? '?'} out tokens`;
          console.log(`  Timing · ${purpose} · ${(record.elapsedMs / 1000).toFixed(1)}s · ${tokens} · ${record.outcome}`);
        }
      });
    },
  };
}
/** Bound polling IO; ignore interrupted writes and retain a partial-history indication. */
function tail(path: string) {
  let fd: number | undefined;
  try {
    const size = statSync(path).size, length = Math.min(size, 4 * 1024 * 1024);
    fd = openSync(path, 'r'); const buffer = Buffer.alloc(length); readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n'); if (size > length) lines.shift();
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
}
export function summarizeMetrics(events: RecordData[], legacy: RecordData[] = [], now = Date.now(), alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } }) {
  const ended = events.filter(e => e.kind === 'request-end');
  // Wrapped Grok requests are also written to its older log. Exclude those legacy duplicates.
  const requests = [...legacy.filter(e => !e.instrumented).map<RecordData>(e => ({ ...e, provider: 'grok' })), ...ended]
    .sort((a,b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).slice(-100);
  const finished = new Set(ended.map(e => e.requestId));
  const active = events.filter(e => e.kind === 'request-start' && !finished.has(e.requestId)).map(e => ({
    purpose: e.purpose, target: e.target, source: e.source, model: e.model,
    elapsedMs: Math.max(0, now - Date.parse(e.startedAt)), status: alive(e.pid) ? 'running' : 'interrupted',
  })).slice(-10);
  const groups = new Map<string, RecordData>();
  for (const r of requests) {
    const key = `${r.provider}/${r.model}/${r.purpose}`;
    const g = groups.get(key) || { provider: r.provider, model: r.model, purpose: r.purpose, calls: 0, failures: 0, durations: [], repeatedPrompts: 0, hashes: new Set(), inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, usageCalls: 0 };
    g.calls++; g.failures += r.outcome !== 'completed' ? 1 : 0;
    if (finite(r.elapsedMs) !== null) g.durations.push(r.elapsedMs);
    if (r.inputHash && g.hashes.has(r.inputHash)) g.repeatedPrompts++;
    g.hashes.add(r.inputHash);
    if (finite(r.inputTokens) !== null && finite(r.outputTokens) !== null) g.usageCalls++;
    for (const key of ['inputTokens','cachedInputTokens','outputTokens','reasoningTokens']) if (finite(r[key]) !== null) g[key] = (g[key] ?? 0) + r[key];
    groups.set(key, g);
  }
  const purposes = [...groups.values()].map(({ durations, hashes, ...g }) => {
    durations.sort((a: number,b: number) => a-b);
    return { ...g, elapsedMs: durations.reduce((a: number,b: number)=>a+b,0), medianMs: (durations.length ? (durations[Math.floor((durations.length-1)/2)] + durations[Math.floor(durations.length/2)]) / 2 : null), p95Ms: durations[Math.max(0, Math.ceil(durations.length * .95)-1)] ?? null };
  }).sort((a,b) => b.elapsedMs - a.elapsedMs);
  const runs = events.filter(e => e.kind === 'run-start').slice(-10).reverse().map(start => {
    const end = events.find(e => e.kind === 'run-end' && e.runId === start.runId);
    const calls = ended.filter(e => e.runId === start.runId);
    const elapsedMs = end?.elapsedMs ?? Math.max(0, now-Date.parse(start.startedAt));
    const modelMs = calls.reduce((sum,e)=>sum+(finite(e.elapsedMs) ?? 0),0);
    return { source: start.source, target: start.target, outcome: end?.outcome ?? (alive(start.pid) ? 'running' : 'interrupted'), elapsedMs, modelMs, outsideModelMs: end ? Math.max(0, elapsedMs-modelMs) : null, calls: calls.length };
  });
  return { sampleSize: requests.length, since: requests[0]?.startedAt ?? null, purposes, active, runs, recent: requests.slice(-12).reverse().map(r => ({purpose:r.purpose, model:r.model, target:r.target, elapsedMs:r.elapsedMs, authMs:r.authMs ?? null, responseHeadersMs:r.responseHeadersMs ?? null, bodyMs:r.bodyMs ?? null, inputTokens:r.inputTokens ?? null, outputTokens:r.outputTokens ?? null, outcome:r.outcome})) };
}
export function readGenerationMetrics(cwd: string) {
  return summarizeMetrics(tail(join(cwd,'.shippost-metrics/events.jsonl')), tail(join(cwd,'.shippost-grok/requests.jsonl')));
}
export function hasRequestMetricsContext() { return !!requestContext.getStore(); }
