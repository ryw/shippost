import type { Tweet } from '../services/x-api.js';

/**
 * Build prompt for analyzing tweets and generating a style guide
 */
export function buildStyleAnalysisPrompt(analysisPrompt: string, tweets: Tweet[]): string {
  const tweetTexts = tweets.map((t, i) => `${i + 1}. ${t.text}`).join('\n\n');

  return `${analysisPrompt}

TWEETS TO ANALYZE:
${tweetTexts}`;
}

/**
 * Parse and validate style guide response from LLM
 */
export function parseStyleGuide(response: string): string {
  // The response should already be in the correct format
  // Just do basic cleanup if needed
  let cleaned = response.trim();

  // Ensure it starts with the header
  if (!cleaned.startsWith('# Posting Style Guide')) {
    // Try to extract the style guide if LLM added preamble
    const match = cleaned.match(/# Posting Style Guide[\s\S]*/);
    if (match) {
      cleaned = match[0];
    }
  }

  return cleaned;
}
