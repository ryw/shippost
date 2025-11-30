import type { ContentStrategy, TranscriptAnalysis, StrategyCategory } from '../types/strategy.js';
import { CONTENT_STRATEGIES, STRATEGY_CATEGORIES } from '../data/strategies.js';

export class StrategySelector {
  constructor(private diversityWeight: number = 0.7) {}

  /**
   * Select strategies based on transcript analysis
   */
  selectStrategies(
    analysis: TranscriptAnalysis,
    count: number,
    preferThreadFriendly: boolean = false
  ): ContentStrategy[] {
    // Filter to applicable strategies
    const applicable = this.filterApplicable(analysis);

    if (applicable.length === 0) {
      // Fallback to general-purpose strategies
      return this.getGeneralPurposeStrategies(count);
    }

    // If we need fewer strategies than available, select diverse ones
    if (applicable.length <= count) {
      return applicable;
    }

    // Select diverse strategies
    return this.selectDiverse(applicable, count, preferThreadFriendly);
  }

  /**
   * Get strategies by IDs (for manual selection)
   */
  getStrategiesByIds(ids: string[]): ContentStrategy[] {
    const strategies: ContentStrategy[] = [];

    for (const id of ids) {
      const strategy = CONTENT_STRATEGIES.find((s) => s.id === id);
      if (strategy) {
        strategies.push(strategy);
      }
    }

    return strategies;
  }

  /**
   * Get all strategies (for listing)
   */
  getAllStrategies(): ContentStrategy[] {
    return [...CONTENT_STRATEGIES];
  }

  /**
   * Get strategies by category
   */
  getStrategiesByCategory(category: StrategyCategory): ContentStrategy[] {
    return STRATEGY_CATEGORIES[category] || [];
  }

  /**
   * Filter strategies by applicability
   */
  private filterApplicable(analysis: TranscriptAnalysis): ContentStrategy[] {
    return CONTENT_STRATEGIES.filter((strategy) => {
      const { applicability } = strategy;

      // worksWithAnyContent always applies
      if (applicability.worksWithAnyContent) {
        return true;
      }

      // Check each applicability requirement
      if (applicability.requiresPersonalNarrative && !analysis.hasPersonalStories) {
        return false;
      }

      if (applicability.requiresActionableKnowledge && !analysis.hasActionableAdvice) {
        return false;
      }

      if (applicability.requiresResources && !analysis.hasResourceMentions) {
        return false;
      }

      if (applicability.requiresProject && !analysis.hasProjectContext) {
        return false;
      }

      if (applicability.requiresStrongOpinion && !analysis.hasStrongOpinions) {
        return false;
      }

      // At least one requirement must be true
      const hasAnyApplicability =
        (applicability.requiresPersonalNarrative && analysis.hasPersonalStories) ||
        (applicability.requiresActionableKnowledge && analysis.hasActionableAdvice) ||
        (applicability.requiresResources && analysis.hasResourceMentions) ||
        (applicability.requiresProject && analysis.hasProjectContext) ||
        (applicability.requiresStrongOpinion && analysis.hasStrongOpinions);

      return hasAnyApplicability;
    });
  }

  /**
   * Select diverse strategies across categories
   */
  private selectDiverse(
    strategies: ContentStrategy[],
    count: number,
    preferThreadFriendly: boolean
  ): ContentStrategy[] {
    const selected: ContentStrategy[] = [];
    const usedCategories: Set<StrategyCategory> = new Set();

    // Group by category
    const byCategory = new Map<StrategyCategory, ContentStrategy[]>();
    for (const strategy of strategies) {
      if (!byCategory.has(strategy.category)) {
        byCategory.set(strategy.category, []);
      }
      byCategory.get(strategy.category)!.push(strategy);
    }

    // First pass: Ensure at least one from each category (diversity)
    for (const [category, categoryStrategies] of byCategory) {
      if (selected.length >= count) break;

      // Filter by thread-friendly preference if needed
      let candidates = categoryStrategies;
      if (preferThreadFriendly) {
        const threadFriendly = categoryStrategies.filter((s) => s.threadFriendly);
        if (threadFriendly.length > 0) {
          candidates = threadFriendly;
        }
      }

      // Pick random from this category
      const strategy = candidates[Math.floor(Math.random() * candidates.length)];
      selected.push(strategy);
      usedCategories.add(category);
    }

    // Second pass: Fill remaining slots with weighted random
    while (selected.length < count) {
      // Filter out already selected strategies
      const remaining = strategies.filter((s) => !selected.includes(s));

      if (remaining.length === 0) break;

      // Apply diversity weight: prefer categories we haven't used much
      const categoryCount = new Map<StrategyCategory, number>();
      for (const strategy of selected) {
        categoryCount.set(strategy.category, (categoryCount.get(strategy.category) || 0) + 1);
      }

      // Weight strategies inversely by how much we've used their category
      const maxCount = Math.max(...categoryCount.values(), 1);
      const weights: number[] = [];

      for (const strategy of remaining) {
        const count = categoryCount.get(strategy.category) || 0;
        // Diversity weight: higher = more diverse (prefer less-used categories)
        const diversityScore = (maxCount - count) * this.diversityWeight;
        // Thread-friendly bonus
        const threadScore = preferThreadFriendly && strategy.threadFriendly ? 0.3 : 0;
        weights.push(1 + diversityScore + threadScore);
      }

      // Weighted random selection
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      let random = Math.random() * totalWeight;

      for (let i = 0; i < remaining.length; i++) {
        random -= weights[i];
        if (random <= 0) {
          selected.push(remaining[i]);
          break;
        }
      }
    }

    return selected;
  }

  /**
   * Get general-purpose strategies (fallback)
   */
  private getGeneralPurposeStrategies(count: number): ContentStrategy[] {
    // Get strategies that work with any content
    const generalPurpose = CONTENT_STRATEGIES.filter((s) => s.applicability.worksWithAnyContent);

    if (generalPurpose.length <= count) {
      return generalPurpose;
    }

    // Randomly select from general-purpose
    const shuffled = [...generalPurpose].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
}
