import Anthropic from '@anthropic-ai/sdk';
import type { T2pConfig } from '../types/config.js';
import { DEFAULT_ANTHROPIC_MODEL, anthropicSupportsTemperature } from './anthropic-models.js';
import type { LLMService } from './llm-service.js';

export class AnthropicService implements LLMService {
  private client: Anthropic;
  private config: T2pConfig;
  private apiKey: string;
  private lastError: Error | null = null;

  constructor(config: T2pConfig) {
    this.config = config;

    // Get API key from env or config
    this.apiKey = process.env.ANTHROPIC_API_KEY || config.anthropic?.apiKey || '';

    if (!this.apiKey) {
      throw new Error(
        'Anthropic API key not found. Save your key in Settings → Credentials.'
      );
    }

    // Credential formats may vary across supported API gateways; validate with the API.
    this.client = new Anthropic({
      apiKey: this.apiKey,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test API key by making a minimal request
      await this.client.messages.create({
        model: this.getModelName(),
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch (error) {
      // Store the error for better reporting
      this.lastError = error as Error;
      return false;
    }
  }

  async ensureAvailable(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      const error = this.lastError;
      let errorMsg = 'Anthropic API is not available.\n';

      if (error) {
        const errorStr = error.toString();

        if (errorStr.includes('401') || errorStr.includes('authentication')) {
          errorMsg += '✗ Authentication failed: Invalid API key\n';
          errorMsg += `  - Check the Anthropic API key in Settings → Credentials\n`;
          errorMsg += `  - Verify your key is current and has API access\n`;
        } else if (errorStr.includes('model')) {
          errorMsg += `✗ Model not found: ${this.getModelName()}\n`;
          errorMsg += '  - Check the model in Settings → Anthropic\n';
        } else if (errorStr.includes('network') || errorStr.includes('ENOTFOUND')) {
          errorMsg += '✗ Network error: Cannot reach Anthropic API\n';
          errorMsg += '  - Check your internet connection\n';
        } else {
          errorMsg += `✗ Error: ${error.message}\n`;
        }
      }

      throw new Error(errorMsg);
    }
  }

  async generate(prompt: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.getModelName(),
        max_tokens: this.config.anthropic?.maxTokens || 4096,
        // Modern Claude models reject non-default sampling parameters.
        ...(this.supportsTemperature()
          ? { temperature: this.config.generation.temperature ?? 0.7 }
          : {}),
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      // Newer models can interleave thinking and multiple text blocks.
      const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      if (text) return text;

      throw new Error('No text content in Anthropic response');
    } catch (error) {
      if ((error as Error).message.includes('model')) {
        throw new Error(`Anthropic model not found: ${this.getModelName()}`);
      }
      throw error;
    }
  }

  getModelName(): string {
    return this.config.anthropic?.model || DEFAULT_ANTHROPIC_MODEL;
  }

  getTemperature(): number | undefined {
    return this.supportsTemperature() ? this.config.generation.temperature ?? 0.7 : undefined;
  }

  supportsTemperature(): boolean {
    return anthropicSupportsTemperature(this.getModelName());
  }
}
