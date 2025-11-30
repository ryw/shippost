import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BangerEvaluation } from '../types/post.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load banger evaluation template
const BANGER_EVAL_TEMPLATE = readFileSync(join(__dirname, '../templates/banger-eval.md'), 'utf-8');

/**
 * Build prompt for evaluating a post's banger potential
 */
export function buildBangerEvalPrompt(postContent: string): string {
  return `${BANGER_EVAL_TEMPLATE}

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
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return null;
    }

    const evaluation = JSON.parse(jsonMatch[0]) as BangerEvaluation;

    // Validate structure
    if (
      typeof evaluation.score !== 'number' ||
      !evaluation.breakdown ||
      typeof evaluation.reasoning !== 'string'
    ) {
      return null;
    }

    // Clamp score to 1-99 range
    evaluation.score = Math.max(1, Math.min(99, evaluation.score));

    return evaluation;
  } catch (error) {
    return null;
  }
}
