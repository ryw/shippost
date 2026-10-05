import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { GrokService } from '../dist/services/grok.js';
import { createLLMService } from '../dist/services/llm-factory.js';
import { DEFAULT_CONFIG } from '../dist/types/config.js';
import { validateConfig } from '../dist/utils/validation.js';

const config = { ...DEFAULT_CONFIG, llm: { provider: 'grok' }, grok: { model: 'grok-4.7' } };
test('Grok provider supports subscription generation with no tools or temperature', async () => {
  const service = createLLMService(config);
  assert.ok(service instanceof GrokService);
  assert.equal(validateConfig(config), true);
  assert.equal(service.getTemperature(), undefined);
  let promptPath;
  service.run = async args => {
    promptPath = args[args.indexOf('--prompt-file') + 1];
    assert.equal(readFileSync(promptPath, 'utf8'), 'Synthetic meeting prompt');
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--deny') + 1], '*');
    assert.ok(args.includes('--disable-web-search'));
    assert.ok(args.includes('--no-subagents'));
    return '  Generated draft  ';
  };
  assert.equal(await service.generate('Synthetic meeting prompt'), 'Generated draft');
  assert.equal(existsSync(promptPath), false);
});
test('Grok removes prompt files on failure and rejects empty responses', async () => {
  const service = new GrokService(config);
  let promptPath;
  service.run = async args => { promptPath = args[args.indexOf('--prompt-file') + 1]; throw new Error('quota'); };
  await assert.rejects(() => service.generate('test'), /quota/);
  assert.equal(existsSync(promptPath), false);
  service.run = async () => '';
  await assert.rejects(() => service.generate('test'), /no content/);
});
