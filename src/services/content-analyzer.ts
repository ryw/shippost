import type { TranscriptAnalysis } from '../types/strategy.js';
import type { LLMService } from './llm-service.js';
import { isRecord, parseJsonFromResponse } from '../utils/json-parser.js';

export class ContentAnalyzer {
  constructor(
    private llm: LLMService,
    private analysisTemplate: string
  ) {}

  async analyzeTranscript(transcript: string): Promise<TranscriptAnalysis> {
    try {
      // Build analysis prompt
      const prompt = `${this.analysisTemplate}

TRANSCRIPT TO ANALYZE:
"""
${transcript}
"""

Provide your analysis as JSON:`;

      // Call LLM
      const response = await this.llm.generate(prompt);

      // Parse response
      const analysis = this.parseAnalysis(response);

      if (analysis) {
        return analysis;
      }

      // Fallback if parsing fails
      return this.getDefaultAnalysis(transcript);
    } catch (error) {
      // Fallback on error
      return this.getDefaultAnalysis(transcript);
    }
  }

  private parseAnalysis(response: string): TranscriptAnalysis | null {
    return parseJsonFromResponse(response, isTranscriptAnalysis, 'object');
  }

  private getDefaultAnalysis(transcript: string): TranscriptAnalysis {
    // Provide conservative default analysis
    const charCount = transcript.length;
    let length: 'short' | 'medium' | 'long' = 'medium';

    if (charCount < 500) {
      length = 'short';
    } else if (charCount > 1500) {
      length = 'long';
    }

    // Default to permissive analysis - mark common characteristics as true
    return {
      contentTypes: ['educational', 'opinion'],
      hasPersonalStories: false,
      hasActionableAdvice: true,
      hasResourceMentions: false,
      hasProjectContext: false,
      hasStrongOpinions: true,
      length,
      characterCount: charCount,
    };
  }
}

function isTranscriptAnalysis(value: unknown): value is TranscriptAnalysis {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.contentTypes) &&
    value.contentTypes.every((item) => typeof item === 'string') &&
    typeof value.hasPersonalStories === 'boolean' &&
    typeof value.hasActionableAdvice === 'boolean' &&
    typeof value.hasResourceMentions === 'boolean' &&
    typeof value.hasProjectContext === 'boolean' &&
    typeof value.hasStrongOpinions === 'boolean' &&
    (value.length === 'short' || value.length === 'medium' || value.length === 'long') &&
    typeof value.characterCount === 'number'
  );
}
