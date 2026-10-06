import { instrumentLLM } from './generation-metrics.js';
import { GrokService } from './grok.js';
import type { T2pConfig } from '../types/config.js';
import type { LLMService } from './llm-service.js';
import { OllamaService } from './ollama.js';
import { AnthropicService } from './anthropic.js';

/**
 * Factory function to create the appropriate LLM service based on config
 */
export function createLLMService(config: T2pConfig): LLMService {
  const provider = config.llm.provider;

  switch (provider) {
    case 'ollama':
      return instrumentLLM(new OllamaService(config), provider);
    case 'grok':
      return instrumentLLM(new GrokService(config), provider);
    case 'anthropic':
      return instrumentLLM(new AnthropicService(config), provider);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
