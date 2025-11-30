export interface Post {
  id: string;
  sourceFile: string;
  content: string;
  metadata: {
    model: string;
    temperature: number;
    tokens?: number;
  };
  timestamp: string;
  status: 'draft' | 'staged' | 'published';
}

export interface PostGenerationResult {
  content: string;
}
