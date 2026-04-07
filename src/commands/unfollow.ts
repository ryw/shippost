import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FileSystemService } from '../services/file-system.js';
import { XAuthService } from '../services/x-auth.js';
import { XApiService, RateLimitError } from '../services/x-api.js';
import { logger } from '../utils/logger.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';
import { readlineSync } from '../utils/readline.js';
import { formatFollowerCount } from '../utils/format.js';

const FOLLOWING_CACHE_FILE = '.shippost-following-cache.json';
const FOLLOWING_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface FollowingAccount {
  id: string;
  username: string;
  name: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  followsBack: boolean;
}

function loadFollowingCache(cwd: string): FollowingAccount[] | null {
  const cacheFile = join(cwd, FOLLOWING_CACHE_FILE);
  if (!existsSync(cacheFile)) return null;
  try {
    const data = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (Date.now() - data.timestamp < FOLLOWING_CACHE_MAX_AGE) {
      return data.accounts;
    }
    return null; // stale
  } catch {
    return null;
  }
}

function saveFollowingCache(cwd: string, accounts: FollowingAccount[]): void {
  const cacheFile = join(cwd, FOLLOWING_CACHE_FILE);
  writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), accounts }, null, 2));
}

function removeFromCache(cwd: string, userId: string): void {
  const accounts = loadFollowingCache(cwd);
  if (!accounts) return;
  const filtered = accounts.filter((a) => a.id !== userId);
  saveFollowingCache(cwd, filtered);
}

interface UnfollowOptions {
  target?: number;
  dryRun?: boolean;
  minFollowers?: number;
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
  const minFollowers = options.minFollowers || 500;

  for (const account of following) {
    const reasons: string[] = [];

    if (account.followersCount < minFollowers) {
      reasons.push(`${formatFollowerCount(account.followersCount)} followers`);
    }
    if (account.tweetCount < 10) reasons.push(`${account.tweetCount} tweets (inactive)`);

    // Quality score: tweets per 1k followers
    // Healthy accounts: 10-500 tweets per 1k followers
    // Dead/bot: <1 tweet per 1k followers (high followers, no activity)
    // Spammy: >1000 tweets per 1k followers (low followers, tons of tweets)
    const tweetsPerKFollowers = account.followersCount > 0
      ? (account.tweetCount / account.followersCount) * 1000
      : account.tweetCount > 0 ? 9999 : 0;

    const isLowQuality =
      account.tweetCount < 10 ||                           // inactive
      account.followersCount < minFollowers ||              // low reach
      tweetsPerKFollowers < 1 ||                            // dead account (has followers but doesn't post)
      tweetsPerKFollowers > 1000;                           // spammy (posts tons, nobody follows)

    if (options.inactive) {
      if (account.tweetCount < 10) {
        candidates.push({ ...account, reason: reasons.join(', ') || 'inactive' });
      }
    } else if (isLowQuality) {
      // Add quality context to reason
      if (tweetsPerKFollowers < 1 && account.followersCount >= minFollowers) {
        reasons.push('dead account');
      } else if (tweetsPerKFollowers > 1000) {
        reasons.push('spammy ratio');
      }
      candidates.push({ ...account, reason: reasons.join(', ') || 'low quality' });
    }
  }

  // Sort: lowest quality first
  candidates.sort((a, b) => {
    // Quality score: lower = less valuable = unfollow first
    // Accounts with 0 tweets go first, then by follower count
    if (a.tweetCount === 0 && b.tweetCount > 0) return -1;
    if (b.tweetCount === 0 && a.tweetCount > 0) return 1;
    const ratioA = a.followersCount > 0 ? a.tweetCount / a.followersCount : 0;
    const ratioB = b.followersCount > 0 ? b.tweetCount / b.followersCount : 0;
    // Accounts furthest from healthy ratio (10-500 per 1k) sort first
    const healthyMid = 0.1; // 100 tweets per 1k followers
    const distA = Math.abs(Math.log((ratioA || 0.001) / healthyMid));
    const distB = Math.abs(Math.log((ratioB || 0.001) / healthyMid));
    return distB - distA; // furthest from healthy = first
  });
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

      let following = loadFollowingCache(cwd);
      if (following) {
        logger.info(style.dim('Using cached following list'));
      } else {
        logger.info('Fetching following list...');
        try {
          following = await apiService.getFollowing(6000);
          saveFollowingCache(cwd, following);
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
            saveFollowingCache(cwd, following);
          } else {
            throw error;
          }
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
          logger.info('Try: --min-followers <n> to raise the threshold, or --inactive');
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
        logger.info(
          `  ${style.dim(`${i + 1}.`)} @${c.username} ${style.dim('•')} ${formatFollowerCount(c.followersCount)} followers ${style.dim('•')} ${c.tweetCount} tweets ${style.dim('•')} ${style.dim(c.reason)}`
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
          removeFromCache(cwd, c.id);
          batchUnfollowed++;
          totalUnfollowed++;
          const remaining = options.target ? ` • ${currentFollowing - totalUnfollowed} → ${options.target}` : '';
          logger.info(`  ${style.red('✗')} @${c.username} ${style.dim(`(${totalUnfollowed} unfollowed${remaining})`)}`);

          // Pace at 1.5s to stay under rate limits
          if (i < batch.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 20000)); // 20s to stay under 50/15min limit
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

      // Refresh cache between batches (free within X's 24h window)
      logger.info(style.dim('Refreshing following list (cached by X, no rate cost)...'));
      try {
        const refreshed = await apiService.getFollowing(6000);
        saveFollowingCache(cwd, refreshed);
      } catch {
        // If refresh fails, local cache is still usable
      }
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
