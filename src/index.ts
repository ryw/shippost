#!/usr/bin/env node

// Load environment variables from .env file
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
import { loadWorkspaceSecrets } from './services/workspace-secrets.js';
loadWorkspaceSecrets(process.cwd());

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { workCommand } from './commands/work.js';
import { postsCommand } from './commands/posts.js';
import { reviewCommand } from './commands/review.js';
import { uiCommand } from './commands/ui/index.js';
import { analyzeXCommand } from './commands/analyze-x.js';
import { replyCommand } from './commands/reply.js';
import { xStatusCommand } from './commands/x-status.js';
import { statsCommand } from './commands/stats.js';
import { syncPromptsCommand } from './commands/sync-prompts.js';
import { lastInputCommand } from './commands/last-input.js';
import { blogCommand } from './commands/blog.js';
import { granolaSyncCommand } from './commands/granola-sync.js';
import { unfollowCommand } from './commands/unfollow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

import { processBlogPrs, readBlogPrStatus } from './services/blog-prs.js';

import { startWorkspaceBackup, checkpointWorkspace, configureWorkspaceBackup, releaseWorkspaceBackup, backupStatus } from './services/workspace-backup.js';
const program = new Command();
program.hook('preAction', (_root, command) => { if (!['ui','backup'].includes(command.name()) && !(command.name()==='review' && command.opts().web)) startWorkspaceBackup(process.cwd()); });
program.hook('postAction', (_root, command) => { if (!['ui','backup'].includes(command.name()) && !(command.name()==='review' && command.opts().web)) checkpointWorkspace(process.cwd()); });
program.command('backup').description('Checkpoint, connect, or release a private workspace backup')
  .option('--repository <owner/name>', 'Connect a dedicated private GitHub repository')
  .option('--release', 'Checkpoint and release the writer after stopping other workspace processes')
  .action(opts => { const cwd=process.cwd(); if(opts.repository)configureWorkspaceBackup(cwd,opts.repository); else if(opts.release)releaseWorkspaceBackup(cwd); else {startWorkspaceBackup(cwd);checkpointWorkspace(cwd);} console.log(JSON.stringify(backupStatus(cwd),null,2)); });

program
  .name('ship')
  .description('Ship posts: Transform meeting transcripts and notes into social media post drafts')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize a new shippost project in the current directory')
  .action(initCommand);

program
  .command('work')
  .description('Generate social posts, blog drafts, or proposed article revisions')
  .option('--target <target>', 'Output: social, blog, or revisions', 'social')
  .option('--sync', 'Sync Granola before generation (otherwise use local inputs)')
  .option('-m, --model <model>', 'Override Ollama model')
  .option('-v, --verbose', 'Verbose output')
  .option('-f, --force', 'Force reprocessing of all files (bypass tracking)')
  .option('-c, --count <number>', 'Number of posts to generate per file', parseInt)
  .option('-s, --strategy <id>', 'Use specific strategy by ID')
  .option('--strategies <ids>', 'Use multiple strategies (comma-separated)')
  .option('--list-strategies', 'List all available strategies')
  .option('--category <category>', 'Filter strategies by category (with --list-strategies)')
  .option('--no-strategies', 'Disable strategy-based generation (use legacy mode)')
  .option('-a, --all', 'Process all transcripts without prompting')
  .option('--files <names>', 'Only process these input files (comma-separated basenames)')
  .action(workCommand);

program
  .command('posts')
  .description('View recently generated posts in human-readable format')
  .option('-n, --count <number>', 'Number of posts to show (default: 10)', parseInt)
  .option('--strategy <name>', 'Filter by strategy name or ID')
  .option('--min-score <score>', 'Show posts with banger score >= N', parseInt)
  .option('--source <text>', 'Filter by source file')
  .option('--eval', 'Evaluate posts missing banger scores')
  .action(postsCommand);

program
  .command('review')
  .description('Review posts one-by-one and approve or reject')
  .option('--min-score <score>', 'Only review posts with score >= N', parseInt)
  .option('--web', 'Review in the local web UI instead of the terminal')
  .option('--port <port>', 'Port for --web (default: 4747)', parseInt)
  .action((opts) => (opts.web ? uiCommand(opts) : reviewCommand(opts)));

program
  .command('ui')
  .description('Local web UI: review, generate, reply, stats, unfollow')
  .option('--port <port>', 'Port (default: 4747)', parseInt)
  .option('--min-score <score>', 'Only show review posts with score >= N', parseInt)
  .action(uiCommand);

program
  .command('analyze-x')
  .description('Generate style guide from X (Twitter) posts')
  .option('-u, --user <username>', 'Analyze another user\'s posts (default: your own)')
  .option('-n, --count <n>', 'Number of tweets to fetch', parseInt, 33)
  .option('--overwrite', 'Overwrite existing style guide without prompting')
  .option('--setup', 'Reconfigure X API credentials')
  .action(analyzeXCommand);

program
  .command('reply')
  .description('Find tweets to reply to and post replies via X API')
  .option('--count <n>', 'Number of tweets to analyze from timeline', parseInt)
  .action(replyCommand);

program
  .command('x-status')
  .description('Check X API rate limits and usage')
  .action(xStatusCommand);

program
  .command('stats')
  .description('Comprehensive X stats dashboard with all metrics')
  .action(statsCommand);

program
  .command('sync-prompts')
  .description('Sync local prompts with package defaults')
  .option('--force', 'Update all prompts without prompting')
  .action(syncPromptsCommand);

program
  .command('last-input')
  .description('Show when the last transcript was added to input/')
  .action(lastInputCommand);

program
  .command('blog')
  .description('Generate blog post drafts from your successful X posts')
  .option('--count <n>', 'Number of posts to fetch (max 100)', parseInt, 50)
  .option('--output <dir>', 'Output directory for drafts', 'content/drafts')
  .option('--auto', 'Auto-select top posts by engagement (no prompts)')
  .action(blogCommand);

program
  .command('granola-sync')
  .description('Sync Granola meeting transcripts to input/ directory')
  .option('--count <n>', 'Number of transcripts to sync', parseInt)
  .option('--force', 'Re-sync all transcripts (ignore previous sync state)')
  .action(async (opts) => {
    try {
      await granolaSyncCommand(opts);
    } catch {
      process.exit(1);
    }
  });

program
  .command('unfollow')
  .description('Clean up your following list to improve follower ratio and engagement')
  .option('--target <n>', 'Keep unfollowing until you follow this many accounts', parseInt)
  .option('--dry-run', 'Show candidates without unfollowing')
  .option('--inactive', 'Only unfollow inactive accounts (<10 tweets)')
  .option('--min-followers <n>', 'Min follower threshold for candidates (default: 500)', parseInt)
  .option('--batch <n>', 'Number of accounts per batch (default: 50)', parseInt)
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(unfollowCommand);

program.command('blog-prs')
  .description('Open one review PR per completed meeting: new essays and revisions')
  .option('--parent <pid>', 'Stop watching when the UI exits')
  .option('--watch', 'Watch for completed meetings in the background')
  .option('--retry', 'Retry failed PR preparation without regenerating content')
  .action(async (opts) => {
    do {
      if (opts.parent) { try { process.kill(Number(opts.parent), 0); } catch { break; } }
      try {
        await processBlogPrs(process.cwd(), { retry: opts.retry });
        if (!opts.watch) console.log(JSON.stringify(readBlogPrStatus(process.cwd()), null, 2));
      } catch (error) { console.error((error as Error).message); if (!opts.watch) process.exitCode = 1; }
      opts.retry = false;
      if (opts.watch) await new Promise(resolve => setTimeout(resolve, 15_000));
    } while (opts.watch);
  });

program.parseAsync().catch(error => { console.error(error.message); process.exitCode = 1; });
