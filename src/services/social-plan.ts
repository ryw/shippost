import type { ContentStrategy } from '../types/strategy.js';
import type { LLMService } from './llm-service.js';
import { isRecord, parseJsonFromResponse } from '../utils/json-parser.js';

export interface SocialAssignment { strategyId: string; angle: string; evidence: string; platform: 'x' | 'linkedin' }
export function renderPrompt(template: string, values: Record<string, string>): string {
  // One pass: placeholders inside meeting notes must never become instructions.
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => values[key] ?? match);
}
export function textOnlyStrategies(strategies: ContentStrategy[]): ContentStrategy[] {
  return strategies.filter(strategy => !strategy.applicability?.requiresVisualAsset &&
    !/\b(photo|photos|photograph|video|screenshot|selfie|meme)\b/i.test(`${strategy.name} ${strategy.prompt}`));
}
export async function planSocialPosts(llm: LLMService, template: string, style: string, transcript: string, strategies: ContentStrategy[], count: number, preferences: { diversityWeight?: number; preferThreadFriendly?: boolean } = {}): Promise<SocialAssignment[]> {
  const response = await llm.generate(renderPrompt(template, {
    style, transcript, count: String(count), selectionPreferences: JSON.stringify(preferences),
    strategies: JSON.stringify(strategies.map(s => ({ id: s.id, instruction: s.prompt, category: s.category, threadFriendly: s.threadFriendly, requirements: s.applicability }))),
  }), 'social-plan');
  const parsed = parseJsonFromResponse(response, isRecord, 'object');
  if (!parsed || !Array.isArray(parsed.posts) || parsed.posts.length === 0 || parsed.posts.length > count) throw new Error('Social plan must contain distinct, grounded assignments within the requested count.');
  const angles = new Set<string>();
  return parsed.posts.map(item => {
    if (!isRecord(item) || !strategies.some(s => s.id === item.strategyId) ||
      typeof item.angle !== 'string' || !item.angle.trim() || typeof item.evidence !== 'string' || !item.evidence.trim() ||
      (item.platform !== 'x' && item.platform !== 'linkedin')) throw new Error('Social plan contains an unsupported assignment.');
    const angle = item.angle.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (angles.has(angle)) throw new Error('Social plan repeated an angle. Retry this target.');
    angles.add(angle);
    return { strategyId: String(item.strategyId), angle: item.angle, evidence: item.evidence, platform: item.platform };
  });
}
