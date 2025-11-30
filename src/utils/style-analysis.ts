import type { Tweet } from '../services/x-api.js';

/**
 * Build prompt for analyzing tweets and generating a style guide
 */
export function buildStyleAnalysisPrompt(tweets: Tweet[]): string {
  const tweetTexts = tweets.map((t, i) => `${i + 1}. ${t.text}`).join('\n\n');

  return `You are a writing style analyst. Your task is to analyze a collection of tweets from a single author and create a comprehensive style guide that captures their unique voice, patterns, and preferences.

TWEETS TO ANALYZE:
${tweetTexts}

Based on these tweets, create a detailed style guide following this exact format:

# Posting Style Guide

## Voice & Tone
[Analyze and describe the author's voice and tone. Consider: Are they casual or formal? Professional or conversational? Humorous or serious? Authoritative or humble? Technical or accessible? List specific characteristics you observe.]

## Brand Guidelines
[Identify recurring themes, topics, and values. What does this person consistently talk about? What are their areas of expertise or interest? What topics do they avoid? What values or principles shine through?]

## Format Preferences
[Analyze their posting patterns: Do they prefer short, punchy posts or longer explanations? Do they use threads? How do they use emojis (frequently, sparingly, never)? Do they use hashtags? How? Do they use formatting like line breaks, bullets, or caps?]

## Examples of Your Best Posts
[Select 3-5 of the most representative tweets that showcase their style at its best. Include the full text of these tweets. Choose tweets that demonstrate their voice, engage their audience, and exemplify their typical content.]

## Target Audience
[Infer who they're writing for based on content, tone, and topics. Consider: What's their audience's level of expertise? What do they care about? What problems are they trying to solve? How technical or casual should content be?]

IMPORTANT GUIDELINES:
- Be specific and concrete in your analysis
- Use actual examples and patterns you observe
- Avoid generic statements - focus on what makes THIS author unique
- Write in second person ("you write...", "your style...") as this will guide the author
- The style guide should be immediately actionable for content generation
- Include at least 3-5 specific observations in each section
- Quote or reference specific tweets when relevant

Generate the complete style guide now:`;
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
