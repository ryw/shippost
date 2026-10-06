import type { LLMService } from './llm-service.js';
import type { T2pConfig } from '../types/config.js';
import { GrokAuth } from './grok-auth.js';

export class GrokService implements LLMService {
  private auth: GrokAuth;
  constructor(private config: T2pConfig, cwd = process.cwd()) { this.auth = new GrokAuth(cwd); }
  async isAvailable(): Promise<boolean> { try { await this.ensureAvailable(); return true; } catch { return false; } }
  async ensureAvailable(): Promise<void> { await this.auth.accessToken(); }
  async generate(prompt: string): Promise<string> {
    const token = await this.auth.accessToken();
    let response: Response;
    try {
      response = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.getModelName(), input: prompt, tools: [], store: false }),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      throw new Error((error as Error).name === 'TimeoutError' ? 'Grok timed out. Retry this target.' : 'Could not reach Grok. Check your connection and retry.');
    }
    if (!response.ok) {
      // Never echo upstream bodies: they can contain prompts or credentials.
      if (response.status === 401) throw new Error('Grok subscription sign-in expired. Reconnect in Settings.');
      if (response.status === 402 || response.status === 429) throw new Error(`Grok subscription usage is limited (HTTP ${response.status}). Check your allowance or retry later.`);
      if (response.status === 403) throw new Error('Your Grok subscription cannot access this model. Check your plan and selected model.');
      throw new Error(`Grok request failed (HTTP ${response.status}). Retry this target.`);
    }
    const data = await response.json() as any;
    if (data.status !== 'completed') throw new Error('Grok did not finish the response. Retry this target.');
    const text = (data.output || []).filter((item: any) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text')
      .map((item: any) => item.text).join('\n').trim();
    if (!text) throw new Error('Grok returned no content. Try again.');
    return text;
  }
  getModelName(): string { return this.config.grok?.model || 'grok-4.7'; }
  getTemperature(): undefined { return undefined; }
}
