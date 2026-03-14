import { createInterface } from 'readline';
import { FileSystemService } from '../services/file-system.js';
import { TypefullyService } from '../services/typefully.js';
import { logger } from '../utils/logger.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';
import { getErrorMessage } from '../utils/error-utils.js';
import type { Post } from '../types/post.js';

interface ReviewOptions {
  minScore?: number;
}

function displayPostForReview(post: Post, remaining: number): void {
  logger.blank();

  // Header with progress and score
  const scoreEmoji =
    (post.metadata.bangerScore || 0) >= 70
      ? '🔥'
      : (post.metadata.bangerScore || 0) >= 50
        ? '✨'
        : '📝';
  const scoreText = post.metadata.bangerScore ? `${scoreEmoji} ${post.metadata.bangerScore}/99` : 'No score';
  const strategyText = post.metadata.strategy?.name || 'No strategy';

  logger.info(`[${remaining} remaining] ${scoreText} • ${strategyText}`);

  // Post content
  logger.info('  ' + '─'.repeat(70));
  const lines = post.content.split('\n');
  lines.forEach((line) => {
    logger.info(`  ${line}`);
  });
  logger.info('  ' + '─'.repeat(70));
}

async function promptForDecision(): Promise<'stage' | 'reject' | 'quit'> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('\n(s)tage  (r)eject  (q)uit: ', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      if (trimmed === 's') {
        resolve('stage');
      } else if (trimmed === 'r') {
        resolve('reject');
      } else if (trimmed === 'q') {
        resolve('quit');
      } else {
        // Re-prompt on unrecognized input
        resolve(promptForDecision());
      }
    });
  });
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const cwd = process.cwd();
  const fs = new FileSystemService(cwd);
  let typefully: TypefullyService | null = null;

  try {
    // Check if initialized
    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }

    // Load config
    const config = fs.loadConfig();

    // Load all posts
    const allPosts = fs.readPosts();

    if (allPosts.length === 0) {
      logger.info('No posts found. Run `ship work` to generate posts.');
      return;
    }

    // Filter to new and keep posts (not staged or rejected)
    let postsToReview = allPosts.filter((p) => p.status === 'new' || p.status === 'keep');

    // Apply min score filter if specified
    if (options.minScore !== undefined) {
      postsToReview = postsToReview.filter(
        (p) => (p.metadata.bangerScore || 0) >= options.minScore!
      );
    }

    // Interleave: alternate between highest banger score and newest posts
    // This ensures newly processed posts get seen alongside top-scored ones
    const byScore = [...postsToReview].sort((a, b) => (b.metadata.bangerScore || 0) - (a.metadata.bangerScore || 0));
    const byNewest = [...postsToReview].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const seen = new Set<string>();
    const interleaved: Post[] = [];
    let si = 0, ni = 0;
    let pickScore = true;
    while (interleaved.length < postsToReview.length) {
      if (pickScore) {
        while (si < byScore.length && seen.has(byScore[si].id)) si++;
        if (si < byScore.length) {
          seen.add(byScore[si].id);
          interleaved.push(byScore[si]);
          si++;
        }
      } else {
        while (ni < byNewest.length && seen.has(byNewest[ni].id)) ni++;
        if (ni < byNewest.length) {
          seen.add(byNewest[ni].id);
          interleaved.push(byNewest[ni]);
          ni++;
        }
      }
      pickScore = !pickScore;
    }
    postsToReview = interleaved;

    if (postsToReview.length === 0) {
      const staged = allPosts.filter((p) => p.status === 'staged').length;
      const rejected = allPosts.filter((p) => p.status === 'rejected').length;

      logger.success('No new posts to review!');
      logger.info(`  Staged: ${staged} • Rejected: ${rejected}`);
      return;
    }

    // Show summary
    logger.blank();
    logger.info(`Found ${postsToReview.length} new posts to review`);
    if (options.minScore) {
      logger.info(`Filtered to posts with score >= ${options.minScore}`);
    }
    logger.info('Posts alternate: highest score ↔ newest first');

    // Review loop
    let reviewed = 0;
    let staged = 0;
    let rejected = 0;

    for (let i = 0; i < postsToReview.length; i++) {
      const post = postsToReview[i];
      const remaining = postsToReview.length - i;

      displayPostForReview(post, remaining);

      const decision = await promptForDecision();

      if (decision === 'quit') {
        logger.blank();
        logger.info(`Session ended. Reviewed ${reviewed} posts`);
        logger.info(`  Staged: ${staged} • Rejected: ${rejected}`);
        logger.info(`${remaining} posts remaining to review`);
        return;
      }

      // Update post status
      if (decision === 'stage') {
        post.status = 'staged';
      } else {
        post.status = 'rejected';
      }

      // If staging, send to Typefully
      if (decision === 'stage') {
        try {
          // Lazy init Typefully service
          if (!typefully) {
            typefully = new TypefullyService(config.typefully?.socialSetId);
          }
          const draft = await typefully.createDraft(post.content);
          post.metadata.typefullyDraftId = draft.id;
          staged++;
          logger.success(`Staged → Typefully [${remaining - 1} remaining]`);
          if (draft.share_url) {
            logger.info(`  ${draft.share_url}`);
          }
        } catch (error) {
          logger.error(`Failed to stage: ${getErrorMessage(error)}`);
          // Revert status on failure
          post.status = 'new';
          continue;
        }
      } else {
        rejected++;
        logger.error(`Rejected [${remaining - 1} remaining]`);
      }

      // Save atomically (re-reads file inside lock to avoid clobbering concurrent appends)
      fs.updatePost(post.id, () => post);

      reviewed++;
    }

    // Final summary
    logger.blank();
    logger.success('Review complete!');
    logger.info(`  Staged: ${staged} • Rejected: ${rejected}`);
  } catch (error) {
    logger.blank();
    logger.error(getErrorMessage(error));
    process.exit(1);
  }
}
