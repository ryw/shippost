import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicService } from '../dist/services/anthropic.js';
import { ANTHROPIC_MODELS, anthropicSupportsTemperature, DEFAULT_ANTHROPIC_MODEL } from '../dist/services/anthropic-models.js';
import { DEFAULT_CONFIG } from '../dist/types/config.js';
import { FileSystemService } from '../dist/services/file-system.js';

function service(model, temperature = 0.7) {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  try { return new AnthropicService({ ...DEFAULT_CONFIG, llm: { provider: 'anthropic' }, anthropic: { model, apiKey: 'sk-ant-test', maxTokens: 4096 }, generation: { temperature } }); }
  finally { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; }
}

test('current and unknown Claude models omit temperature from requests and metadata', async () => {
  for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-4-7', 'claude-opus-4-10', 'claude-sonnet-6', 'custom-model']) {
    const llm = service(model, 0);
    let request;
    llm.client.messages.create = async body => {
      request = body;
      return { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'First' }, { type: 'text', text: 'Second' }] };
    };
    assert.equal(await llm.generate('synthetic'), 'First\nSecond');
    assert.equal(request.model, model);
    assert.equal(Object.hasOwn(request, 'temperature'), false, model);
    assert.equal(llm.getTemperature(), undefined);
    const post = new FileSystemService().createPost('test.txt', 'test', model, llm.getTemperature());
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(post)).metadata, 'temperature'), false);
  }
});

test('known compatible models retain explicit zero and dated aliases', async () => {
  for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-3-5-sonnet-latest']) {
    const llm = service(model, 0);
    let request;
    llm.client.messages.create = async body => { request = body; return { content: [{ type: 'text', text: 'Test' }] }; };
    await llm.generate('synthetic');
    assert.equal(request.temperature, 0, model);
    assert.equal(llm.getTemperature(), 0);
  }
});

test('catalog and defaults agree; omitted model uses the current default', () => {
  assert.equal(DEFAULT_CONFIG.anthropic.model, DEFAULT_ANTHROPIC_MODEL);
  assert.ok(ANTHROPIC_MODELS.some(model => model.id === DEFAULT_ANTHROPIC_MODEL));
  assert.equal(service(undefined).getModelName(), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(anthropicSupportsTemperature(DEFAULT_ANTHROPIC_MODEL), false);
});
