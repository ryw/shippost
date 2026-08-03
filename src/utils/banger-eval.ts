import type { BangerEvaluation } from '../types/post.js';
import { isRecord, parseJsonFromResponse } from './json-parser.js';

/**
 * Build prompt for evaluating a post's banger potential
 */
export function buildBangerEvalPrompt(bangerEvalTemplate: string, postContent: string): string {
  return `${bangerEvalTemplate}

POST TO EVALUATE:
"""
${postContent}
"""

Provide your evaluation now:`;
}

/**
 * Parse banger evaluation response from LLM
 */
export function parseBangerEval(response: string): BangerEvaluation | null {
  const evaluation = parseJsonFromResponse(response, isBangerEvaluation, 'object');
  if (!evaluation) return null;

  return {
    ...evaluation,
    score: Math.max(1, Math.min(99, evaluation.score)),
  };
}

function isBangerEvaluation(value: unknown): value is BangerEvaluation {
  if (!isRecord(value) || !isRecord(value.breakdown)) return false;
  const breakdown = value.breakdown;
  const breakdownKeys = ['hook', 'emotional', 'value', 'format', 'relevance', 'engagement', 'authenticity'];
  return (
    typeof value.score === 'number' &&
    typeof value.reasoning === 'string' &&
    breakdownKeys.every((key) => typeof breakdown[key] === 'number')
  );
}
