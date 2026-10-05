export const GENERATION_TARGETS = ['social', 'blog', 'revisions'] as const;
export type GenerationTarget = typeof GENERATION_TARGETS[number];

export function isGenerationTarget(value: unknown): value is GenerationTarget {
  return GENERATION_TARGETS.includes(value as GenerationTarget);
}

export interface ProcessedFileInfo {
  path: string;
  processedAt: string; // ISO timestamp
  modifiedAt: string; // ISO timestamp of file modification
  postsGenerated: number;
  targets?: Partial<Record<GenerationTarget, { processedAt: string; postsGenerated: number }>>;
}

export interface T2pState {
  processedFiles: Record<string, ProcessedFileInfo>;
}
