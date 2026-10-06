import { reportModelMetrics, hasRequestMetricsContext } from './generation-metrics.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { LLMService, LLMPurpose } from './llm-service.js';
import type { T2pConfig } from '../types/config.js';
import { GrokAuth } from './grok-auth.js';

export class GrokService implements LLMService {
  private auth: GrokAuth;
  constructor(private config: T2pConfig, private cwd = process.cwd()) { this.auth = new GrokAuth(cwd); }
  async isAvailable(): Promise<boolean> { try { await this.ensureAvailable(); return true; } catch { return false; } }
  async ensureAvailable(): Promise<void> { await this.auth.accessToken(); }
  async generate(prompt: string, purpose: LLMPurpose = 'unspecified'): Promise<string> {
    const started = Date.now();
    const metrics: Record<string, unknown> = {
      requestId: randomUUID(), startedAt: new Date(started).toISOString(), purpose,
      model: this.getModelName(), reasoningEffort: this.config.grok?.reasoningEffort || 'high',
      inputCharacters: prompt.length, inputHash: createHash('sha256').update(prompt).digest('hex'), outcome: 'error',
    };
    try { return await this.request(prompt, metrics); }
    finally {
      metrics.elapsedMs = Date.now() - started;
      metrics.instrumented = hasRequestMetricsContext();
      reportModelMetrics(metrics);
      // Diagnostics must never store prompts, responses, credentials, or upstream errors.
      try {
        const directory = join(this.cwd, '.shippost-grok');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(join(directory, '.gitignore'), '*\n', { mode: 0o600 });
        appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify(metrics) + '\n', { mode: 0o600 });
      } catch { /* Diagnostics must not prevent a draft from being saved. */ }
    }
  }
  private async request(prompt: string, metrics: Record<string, unknown>): Promise<string> {
    const authStarted = Date.now();
    const token = await this.auth.accessToken();
    metrics.authMs = Date.now() - authStarted;
    const requestStarted = Date.now();
    let response: Response;
    try {
      response = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.getModelName(), input: prompt, tools: [], store: false, reasoning: { effort: this.config.grok?.reasoningEffort || 'high' } }),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      metrics.outcome = (error as Error).name === 'TimeoutError' ? 'timeout' : 'network-error';
      throw new Error((error as Error).name === 'TimeoutError' ? 'Grok timed out. Retry this target.' : 'Could not reach Grok. Check your connection and retry.');
    }
    metrics.responseHeadersMs = Date.now() - requestStarted;
    metrics.httpStatus = response.status;
    if (!response.ok) {
      metrics.outcome = 'http-error';
      // Never echo upstream bodies: they can contain prompts or credentials.
      if (response.status === 401) throw new Error('Grok subscription sign-in expired. Reconnect in Settings.');
      if (response.status === 402 || response.status === 429) throw new Error(`Grok subscription usage is limited (HTTP ${response.status}). Check your allowance or retry later.`);
      if (response.status === 403) throw new Error('Your Grok subscription cannot access this model. Check your plan and selected model.');
      throw new Error(`Grok request failed (HTTP ${response.status}). Retry this target.`);
    }
    const bodyStarted = Date.now();
    const data = await response.json() as any;
    metrics.bodyMs = Date.now() - bodyStarted;
    const tokenCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    metrics.inputTokens = tokenCount(data.usage?.input_tokens);
    metrics.cachedInputTokens = tokenCount(data.usage?.input_tokens_details?.cached_tokens);
    metrics.outputTokens = tokenCount(data.usage?.output_tokens);
    metrics.reasoningTokens = tokenCount(data.usage?.output_tokens_details?.reasoning_tokens);
    metrics.outcome = 'incomplete';
    if (data.status !== 'completed') throw new Error('Grok did not finish the response. Retry this target.');
    const text = (data.output || []).filter((item: any) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text')
      .map((item: any) => item.text).join('\n').trim();
    metrics.outputCharacters = text.length;
    metrics.outcome = text ? 'completed' : 'empty';
    if (!text) throw new Error('Grok returned no content. Try again.');
    return text;
  }
  getModelName(): string { return this.config.grok?.model || 'grok-4.7'; }
  getTemperature(): undefined { return undefined; }
}
