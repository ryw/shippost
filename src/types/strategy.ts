export type StrategyCategory =
  | 'personal'
  | 'educational'
  | 'provocative'
  | 'engagement'
  | 'curation'
  | 'behind-the-scenes'
  | 'reflective';

export interface StrategyApplicability {
  requiresPersonalNarrative?: boolean;
  requiresActionableKnowledge?: boolean;
  requiresResources?: boolean;
  requiresProject?: boolean;
  requiresStrongOpinion?: boolean;
  worksWithAnyContent?: boolean;
}

export interface ContentStrategy {
  id: string;
  name: string;
  prompt: string;
  category: StrategyCategory;
  threadFriendly: boolean;
  applicability: StrategyApplicability;
}

export interface TranscriptAnalysis {
  contentTypes: string[];
  hasPersonalStories: boolean;
  hasActionableAdvice: boolean;
  hasResourceMentions: boolean;
  hasProjectContext: boolean;
  hasStrongOpinions: boolean;
  length: 'short' | 'medium' | 'long';
  characterCount: number;
}
