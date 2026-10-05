import { spawn } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LLMService } from './llm-service.js';
import type { T2pConfig } from '../types/config.js';

export class GrokService implements LLMService {
  constructor(private config: T2pConfig, private cwd = process.cwd()) {}
  async isAvailable(): Promise<boolean> { try { await this.ensureAvailable(); return true; } catch { return false; } }
  async ensureAvailable(): Promise<void> {
    if (!existsSync(join(this.cwd, '.shippost-grok', 'auth.json'))) throw new Error('Sign in to Grok Build on this computer first.');
    await this.run(['models']);
  }
  private run(args: string[], dir = tmpdir()): Promise<string> {
    const env = { ...process.env, GROK_HOME: join(this.cwd, '.shippost-grok'), GROK_DISABLE_AUTOUPDATER: '1', GROK_MEMORY: '0', GROK_SUBAGENTS: '0' } as NodeJS.ProcessEnv;
    delete env.XAI_API_KEY;
    delete env.GROK_MODELS_BASE_URL;
    delete env.GROK_MODELS_LIST_URL;
    delete env.GROK_XAI_API_BASE_URL;
    return new Promise((resolve, reject) => {
      const child = spawn('grok', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Grok timed out. Check your connection and retry.')); }, 300000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 10000000) { child.kill(); reject(new Error('Grok response exceeded the size limit.')); }
      });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('Grok Build is not installed on this computer.')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error('Grok could not complete the request. Check your Grok sign-in and subscription limits.'));
        else resolve(output);
      });
    });
  }
  async generate(prompt: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'shippost-grok-'));
    try {
      const path = join(dir, 'prompt.txt');
      writeFileSync(path, prompt, { mode: 0o600 });
      const result = await this.run(['--prompt-file', path, '--verbatim', '--output-format', 'plain', '--model', this.getModelName(), '--tools', '', '--deny', '*', '--disable-web-search', '--no-subagents', '--max-turns', '1'], dir);
      if (!result.trim()) throw new Error('Grok returned no content. Try again.');
      return result.trim();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  getModelName(): string { return this.config.grok?.model || 'grok-4.7'; }
  getTemperature(): undefined { return undefined; }
}
