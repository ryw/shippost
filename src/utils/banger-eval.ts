import type { BangerEvaluation } from '../types/post.js';

/**
 * Extract a balanced JSON object starting at the given index
 */
function extractBalancedJson(str: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

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
  try {
    // Try to extract JSON from the response
    // Use greedy match to get the outermost braces (nested objects like breakdown)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    // If there are multiple top-level objects, we want the one with "score"
    let jsonStr = jsonMatch[0];

    // Try parsing as-is first
    let evaluation: BangerEvaluation;
    try {
      evaluation = JSON.parse(jsonStr) as BangerEvaluation;
    } catch {
      // If that fails, try to find a complete JSON object with "score"
      // by finding balanced braces
      let startIdx = response.indexOf('{"score"');
      if (startIdx === -1) {
        // Try with spaces: { "score"
        startIdx = response.indexOf('{ "score"');
      }
      if (startIdx === -1) {
        return null;
      }
      const extracted = extractBalancedJson(response, startIdx);
      if (!extracted) {
        return null;
      }
      jsonStr = extracted;
      evaluation = JSON.parse(jsonStr) as BangerEvaluation;
    }

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
