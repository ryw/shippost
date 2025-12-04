export interface BangerScoreBreakdown {
  hook: number;
  emotional: number;
  value: number;
  format: number;
  relevance: number;
  engagement: number;
  authenticity: number;
}

export interface BangerEvaluation {
  score: number;
  breakdown: BangerScoreBreakdown;
  reasoning: string;
}

export interface Post {
  id: string;
  sourceFile: string;
  content: string;
  metadata: {
    model: string;
    temperature: number;
    tokens?: number;
    bangerScore?: number;
    bangerEvaluation?: BangerEvaluation;
    strategy?: {
      id: string;
      name: string;
      category: string;
    };
    typefullyDraftId?: string;
  };
  timestamp: string;
  status: 'new' | 'keep' | 'staged' | 'published' | 'rejected';
}

export interface PostGenerationResult {
  content: string;
}
