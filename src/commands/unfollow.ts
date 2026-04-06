import { FileSystemService } from '../services/file-system.js';
import { XAuthService } from '../services/x-auth.js';
import { XApiService, RateLimitError } from '../services/x-api.js';
import { logger } from '../utils/logger.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';
import { readlineSync } from '../utils/readline.js';
import { formatFollowerCount } from '../utils/format.js';

interface UnfollowOptions {
  target?: number;
  dryRun?: boolean;
  minFollowers?: number;
  noFollowBack?: boolean;
  inactive?: boolean;
  batch?: number;
  yes?: boolean;
}

interface UnfollowCandidate {
  id: string;
  username: string;
  name: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  followsBack: boolean;
  reason: string;
}

function buildCandidates(
  following: Array<{ id: string; username: string; name: string; followersCount: number; followingCount: number; tweetCount: number; followsBack: boolean }>,
  options: UnfollowOptions
): UnfollowCandidate[] {
  const candidates: UnfollowCandidate[] = [];

  for (const account of following) {
    const reasons: string[] = [];

    if (!account.followsBack) reasons.push('no follow-back');
    if (account.followersCount < (options.minFollowers || 100)) {
      reasons.push(`${formatFollowerCount(account.followersCount)} followers`);
    }
    if (account.tweetCount < 10) reasons.push(`${account.tweetCount} tweets (inactive)`);

    if (options.noFollowBack && !account.followsBack) {
      candidates.push({ ...account, reason: reasons.join(', ') || 'no follow-back' });
    } else if (options.inactive && account.tweetCount < 10) {
      candidates.push({ ...account, reason: reasons.join(', ') || 'inactive' });
    } else if (!options.noFollowBack && !options.inactive) {
      if (!account.followsBack && account.followersCount < 50000) {
        candidates.push({ ...account, reason: reasons.join(', ') || 'no follow-back' });
      }
    }
  }

  // Sort: lowest follower count first (least valuable follows)
  candidates.sort((a, b) => a.followersCount - b.followersCount);
  return candidates;
}

export async function unfollowCommand(options: UnfollowOptions): Promise<void> {
  const cwd = process.cwd();
  const { style } = logger;

  try {
    logger.section('[1/3] Connecting to X...');

    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }

    const fs = new FileSystemService(cwd);
    const config = fs.loadConfig();

    const clientId = config.x?.clientId;
    if (!clientId) {
      logger.error('X API not configured. Run `ship analyze-x --setup` first.');
      process.exit(1);
    }

    const authService = new XAuthService(cwd, clientId);
    const accessToken = await authService.getValidToken();
    const apiService = new XApiService(accessToken);

    const user = await apiService.getMe();
    logger.success(`Authenticated as @${user.username}`);

    let totalUnfollowed = 0;
    let totalErrors = 0;
    let currentFollowing = 0;

    // Loop: fetch → score → unfollow batch → repeat until target reached
    while (true) {
      logger.section(totalUnfollowed === 0 ? '[2/3] Analyzing who you follow...' : `[2/3] Re-fetching following list...`);

      logger.info('Fetching following list...');
      let following;
      try {
        following = await apiService.getFollowing(6000);
      } catch (error) {
        if (error instanceof RateLimitError && options.target) {
          const resetTime = error.resetAt && !isNaN(error.resetAt.getTime()) ? error.resetAt.getTime() : 0;
          const waitMs = resetTime > Date.now()
            ? resetTime - Date.now() + 5000
            : 15 * 60 * 1000;
          const waitMin = Math.ceil(waitMs / 60000);
          logger.info(`${style.yellow('⏳')} Rate limited on fetch. Waiting ${waitMin} min...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          following = await apiService.getFollowing(6000);
        } else {
          throw error;
        }
      }
      currentFollowing = following.length;
      logger.success(`You follow ${currentFollowing} accounts`);

      // Check if target reached
      if (options.target && currentFollowing <= options.target) {
        logger.blank();
        logger.success(`Target reached! Following ${currentFollowing} accounts (target: ${options.target})`);
        break;
      }

      const candidates = buildCandidates(following, options);

      // How many to unfollow this round
      let batchSize = options.batch || 50;
      if (options.target) {
        const needToRemove = currentFollowing - options.target;
        batchSize = Math.min(batchSize, needToRemove, candidates.length);
        logger.info(`Need to unfollow ${needToRemove} to reach target of ${options.target}`);
      }

      const batch = candidates.slice(0, batchSize);

      if (batch.length === 0) {
        logger.blank();
        if (options.target && currentFollowing > options.target) {
          logger.info(`No more candidates match filters, but still following ${currentFollowing} (target: ${options.target}).`);
          logger.info('Try broader filters: --no-follow-back or --min-followers <n>');
        } else {
          logger.success('No unfollow candidates found with current filters.');
        }
        break;
      }

      // Show the batch
      logger.blank();
      logger.info(`Batch: ${batch.length} accounts to unfollow`);
      logger.blank();

      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        const followBack = c.followsBack ? style.green('✓ follows you') : style.dim('✗ no follow-back');
        logger.info(
          `  ${style.dim(`${i + 1}.`)} @${c.username} ${style.dim('•')} ${formatFollowerCount(c.followersCount)} followers ${style.dim('•')} ${followBack} ${style.dim('•')} ${style.dim(c.reason)}`
        );
      }

      if (options.dryRun) {
        logger.blank();
        logger.info('Dry run — no accounts unfollowed.');
        if (options.target) {
          logger.info(`Would need ~${currentFollowing - options.target} total unfollows to reach target.`);
          logger.info(`${candidates.length} candidates match current filters.`);
        }
        break;
      }

      // Confirm (first batch only, or always if no --yes)
      if (!options.yes && totalUnfollowed === 0) {
        logger.blank();
        const targetInfo = options.target ? ` (targeting ${options.target})` : '';
        const answer = await readlineSync(`Unfollow this batch of ${batch.length}${targetInfo}? (y/n) `);
        if (answer.trim().toLowerCase() !== 'y') {
          logger.info('Cancelled.');
          break;
        }
      }

      // Unfollow the batch
      logger.section('[3/3] Unfollowing...');

      let batchUnfollowed = 0;
      let rateLimited = false;

      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        try {
          await apiService.unfollowUser(c.id);
          batchUnfollowed++;
          totalUnfollowed++;
          const remaining = options.target ? ` • ${currentFollowing - totalUnfollowed} → ${options.target}` : '';
          logger.info(`  ${style.red('✗')} @${c.username} ${style.dim(`(${totalUnfollowed} unfollowed${remaining})`)}`);

          // Pace at 1.5s to stay under rate limits
          if (i < batch.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        } catch (error) {
          if (error instanceof RateLimitError) {
            const resetTime = error.resetAt && !isNaN(error.resetAt.getTime()) ? error.resetAt.getTime() : 0;
            const waitMs = resetTime > Date.now()
              ? resetTime - Date.now() + 5000
              : 15 * 60 * 1000; // default 15 min
            const waitMin = Math.ceil(waitMs / 60000);

            if (options.target) {
              logger.info(`  ${style.yellow('⏳')} Rate limited. Waiting ${waitMin} min then resuming...`);
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              // Retry this same account
              i--;
              totalErrors--; // don't count as error
              continue;
            } else {
              logger.error('Rate limited — stopping. Run again later.');
              rateLimited = true;
              break;
            }
          }
          totalErrors++;
          logger.error(`  Failed @${c.username}: ${(error as Error).message}`);
        }
      }

      logger.blank();
      logger.info(`Batch complete: ${batchUnfollowed} unfollowed this round, ${totalUnfollowed} total`);

      if (rateLimited) break;

      // If no target, just do one batch
      if (!options.target) break;

      // Brief pause between batches
      logger.info(style.dim('Pausing before next batch...'));
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Final summary
    logger.blank();
    logger.success('Done!');
    logger.info(`  Total unfollowed: ${totalUnfollowed}`);
    if (totalErrors > 0) logger.info(`  Errors: ${totalErrors}`);
    logger.info(`  Now following: ~${currentFollowing - totalUnfollowed}`);
  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
