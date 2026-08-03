import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawn, exec } from 'child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { FileSystemService } from '../../services/file-system.js';
import { TypefullyService } from '../../services/typefully.js';
import { AnthropicService } from '../../services/anthropic.js';
import { XAuthService } from '../../services/x-auth.js';
import { XApiService, RateLimitError } from '../../services/x-api.js';
import { createLLMService } from '../../services/llm-factory.js';
import { logger } from '../../utils/logger.js';
import { isShippostProject } from '../../utils/validation.js';
import { NotInitializedError } from '../../utils/errors.js';
import type { Post } from '../../types/post.js';
import {
  gatherReplyTweets,
  buildReplyPrompt,
  parseReplyOpportunities,
  addToSkipCache,
  loadFeedSeen,
} from '../reply.js';
import {
  getMeWithMetrics,
  getRecentTweetsWithMetrics,
  getDailyPostCounts,
  getDailyImpressions,
  getHourlyEngagement,
  type TweetWithMetrics,
} from '../stats.js';
import {
  buildCandidates,
  loadFollowingCache,
  saveFollowingCache,
  removeFromCache,
  loadWhitelist,
  addToWhitelist,
} from '../unfollow.js';
import {
  loadGranolaRefreshToken,
  refreshAccessToken,
  fetchGranolaDocuments,
} from '../granola-sync.js';
import { PAGE } from './page.js';
import { isRecord, parseJsonFromResponse } from '../../utils/json-parser.js';

const TRANSCRIPT_META_FILE = '.shippost-transcript-meta.json';
const RELEVANCE_CACHE_FILE = '.shippost-relevance-cache.json';
const PENDING_UNFOLLOW_FILE = '.shippost-unfollow-pending.json';

/** Durable unfollow decisions, id → {username, queuedAt}. Held across cap
 *  hits and server restarts; drained by the unfollow worker. */
function loadPendingUnfollows(cwd: string): Record<string, { username: string; queuedAt: string }> {
  try {
    return JSON.parse(readFileSync(join(cwd, PENDING_UNFOLLOW_FILE), 'utf8'));
  } catch {
    return {};
  }
}

async function savePendingUnfollows(cwd: string, pending: Record<string, { username: string; queuedAt: string }>): Promise<void> {
  const { writeFileSync } = await import('fs');
  writeFileSync(join(cwd, PENDING_UNFOLLOW_FILE), JSON.stringify(pending, null, 2));
}

// What "relevant to Ry" means for follow-list curation
const RY_INTERESTS =
  'agentic engineering and AI coding agents, developer tools, startups/founders/venture, ' +
  'cloud infrastructure, Postgres and data systems, engineering leadership, Cincinnati tech';

interface RelevanceScoreResult {
  id: string;
  score: number;
  note?: string;
}

function isRelevanceScoreResults(value: unknown): value is RelevanceScoreResult[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.score === 'number' &&
    (item.note === undefined || typeof item.note === 'string')
  );
}

interface TranscriptMeta {
  [filename: string]: { attendees?: string[]; summary?: string; skipped?: boolean };
}

interface UiOptions {
  port?: number;
  minScore?: number;
}

interface Job {
  running: boolean;
  log: string[];
  result?: unknown;
  error?: string;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

export async function uiCommand(options: UiOptions): Promise<void> {
  const cwd = process.cwd();
  const fs = new FileSystemService(cwd);
  let typefully: TypefullyService | null = null;
  let anthropic: AnthropicService | null = null;
  const jobs: Record<string, Job> = {};
  const genQueue: string[] = [];
  let genActive: string | null = null;

  // Drain the durable pending-unfollow ledger; cap/rate-limit hits leave the
  // rest pending for a later retry.
  const runUnfollowWorker = () => startJob('unfollow-run', async (job) => {
    const { api } = await xApi();
    let done = 0;
    while (true) {
      const pending = loadPendingUnfollows(cwd);
      const ids = Object.keys(pending);
      if (!ids.length) break;
      const id = ids[0];
      const uname = pending[id].username || id;
      try {
        await api.unfollowUser(id);
        removeFromCache(cwd, id);
        delete pending[id];
        await savePendingUnfollows(cwd, pending);
        done++;
        job.log.push(`✗ @${uname} unfollowed (${ids.length - 1} pending)`);
      } catch (error) {
        const msg = (error as Error).message;
        if (error instanceof RateLimitError || msg.includes('402')) {
          job.log.push(msg.includes('402')
            ? `✗ X monthly cap — holding ${ids.length} decisions, will retry on next server start or Retry click`
            : `⏳ rate limited — holding ${ids.length} decisions, retry in ~15 min`);
          break;
        }
        // Hard per-account failure (deactivated, suspended) — drop the decision
        delete pending[id];
        await savePendingUnfollows(cwd, pending);
        job.log.push(`skipped @${uname}: ${msg}`);
      }
      if (Object.keys(loadPendingUnfollows(cwd)).length) {
        await new Promise((r) => setTimeout(r, 20000)); // pace under 50/15min
      }
    }
    job.result = { unfollowed: done, pending: Object.keys(loadPendingUnfollows(cwd)).length };
  });
  const metaPath = join(cwd, TRANSCRIPT_META_FILE);

  const loadMeta = (): TranscriptMeta => {
    try {
      return JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      return {};
    }
  };
  const saveMeta = async (meta: TranscriptMeta) => {
    const { writeFileSync } = await import('fs');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  };

  // One Granola fetch per server run: filename → attendee names (excluding Ry).
  let attendeesPromise: Promise<Record<string, string[]>> | null = null;
  const granolaAttendees = (): Promise<Record<string, string[]>> => {
    if (!attendeesPromise) {
      attendeesPromise = (async () => {
        const statePath = join(cwd, '.granola-sync-state.json');
        if (!existsSync(statePath)) return {};
        const syncState = JSON.parse(readFileSync(statePath, 'utf8'));
        const docToFile: Record<string, string> = {};
        for (const [docId, v] of Object.entries(syncState.syncedDocuments || {})) {
          docToFile[docId] = (v as { filename: string }).filename;
        }
        const token = await refreshAccessToken(loadGranolaRefreshToken());
        const docs = await fetchGranolaDocuments(token);
        const out: Record<string, string[]> = {};
        for (const [docId, doc] of Object.entries(docs)) {
          const filename = docToFile[docId];
          if (!filename) continue;
          const raw = doc.google_calendar_event?.attendees?.map((a) => a.displayName || a.email || '')
            || doc.people?.attendees?.map((a) => a.name || a.email || '')
            || [];
          const names = [...new Set(raw
            .filter(Boolean)
            .filter((n) => !/^ry@|ry walker/i.test(n))
            .map((n) => n.includes('@') ? n.split('@')[0] : n))];
          if (names.length) out[filename] = names;
        }
        return out;
      })().catch(() => ({}));
    }
    return attendeesPromise;
  };

  const startJob = (name: string, fn: (job: Job) => Promise<void>): boolean => {
    if (jobs[name]?.running) return false;
    const job: Job = { running: true, log: [] };
    jobs[name] = job;
    fn(job)
      .catch((err) => { job.error = (err as Error).message; job.log.push(`✗ ${(err as Error).message}`); })
      .finally(() => { job.running = false; });
    return true;
  };

  const xApi = async (): Promise<{ api: XApiService; username: string }> => {
    const config = fs.loadConfig();
    const clientId = config.x?.clientId;
    if (!clientId) throw new Error('X API not configured. Run `ship analyze-x --setup` first.');
    const auth = new XAuthService(cwd, clientId);
    const token = await auth.getValidToken();
    const api = new XApiService(token);
    const me = await api.getMe();
    return { api, username: me.username };
  };

  try {
    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }
    const config = fs.loadConfig();
    const port = options.port || 4747;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const send = (status: number, body: string, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
      };
      const readBody = async (): Promise<Record<string, unknown>> => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        return JSON.parse(raw || '{}');
      };
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const route = `${req.method} ${url.pathname}`;

      try {
        if (route === 'GET /') return send(200, PAGE, 'text/html');

        // ── jobs ─────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname.startsWith('/api/job/')) {
          const job = jobs[url.pathname.slice('/api/job/'.length)];
          if (!job) return send(200, JSON.stringify({ running: false, log: [] }));
          return send(200, JSON.stringify(job));
        }

        // ── review ───────────────────────────────────────────────────
        if (route === 'GET /api/posts') {
          let posts = fs.readPosts().filter((p) => p.status === 'new' || p.status === 'keep');
          if (options.minScore !== undefined) {
            posts = posts.filter((p) => (p.metadata.bangerScore || 0) >= options.minScore!);
          }
          const sorted = [...posts].sort((a, b) => (b.metadata.bangerScore || 0) - (a.metadata.bangerScore || 0));
          const queue = sorted.map((p) => ({
            id: p.id,
            platform: p.platform || 'x',
            score: p.metadata.bangerScore || 0,
            sourceFile: p.sourceFile,
            content: p.content,
          }));
          return send(200, JSON.stringify({ posts: queue }));
        }

        if (route === 'POST /api/decision') {
          const { id, action, content } = await readBody();
          const post = fs.readPosts().find((p) => p.id === id);
          if (!post) return send(404, JSON.stringify({ error: 'post not found' }));
          if (action !== 'stage' && action !== 'reject') {
            return send(400, JSON.stringify({ error: 'action must be stage or reject' }));
          }
          const finalContent = typeof content === 'string' && content.trim() ? content : post.content;
          let shareUrl: string | undefined;
          if (action === 'stage') {
            if (!typefully) typefully = new TypefullyService(config.typefully?.socialSetId);
            const draft = await typefully.createDraft(finalContent, post.platform || 'x');
            post.metadata.typefullyDraftId = draft.id;
            shareUrl = draft.share_url;
          }
          post.content = finalContent;
          post.status = action === 'stage' ? 'staged' : 'rejected';
          fs.updatePost(post.id, () => post);
          logger.info(`${action === 'stage' ? 'Staged' : 'Rejected'}: ${finalContent.slice(0, 60).replace(/\n/g, ' ')}…`);
          return send(200, JSON.stringify({ ok: true, share_url: shareUrl }));
        }

        if (route === 'POST /api/rewrite') {
          const { content, start, end, instruction, platform } = await readBody() as {
            content: string; start: number; end: number; instruction: string; platform?: string;
          };
          if (typeof content !== 'string' || typeof instruction !== 'string' || !(end > start)) {
            return send(400, JSON.stringify({ error: 'need content, selection range, instruction' }));
          }
          if (!anthropic) anthropic = new AnthropicService(config);
          let style = '';
          try {
            style = readFileSync(join(cwd, 'prompts', 'style.md'), 'utf-8');
          } catch { /* style guide optional */ }
          const selection = content.slice(start, end);
          const prompt = [
            `You are editing a ${platform === 'linkedin' ? 'LinkedIn' : 'X'} post or reply.`,
            style ? `Author's style guide:\n<style>\n${style}\n</style>` : '',
            `Full text:\n<post>\n${content}\n</post>`,
            `The author selected this span:\n<selection>\n${selection}\n</selection>`,
            `Instruction: ${instruction}`,
            `Rewrite ONLY the selected span per the instruction, matching the surrounding voice. Never use em dashes. Return ONLY the replacement text for the span — no quotes around it, no preamble, no explanation.`,
          ].filter(Boolean).join('\n\n');
          let replacement = (await anthropic.generate(prompt)).trim();
          replacement = replacement.replace(/^(Here('|’)s.*?:|Replacement:)\s*/i, '').trim();
          if (replacement.length >= 2 && replacement.startsWith('"') && replacement.endsWith('"') && !selection.startsWith('"')) {
            replacement = replacement.slice(1, -1);
          }
          return send(200, JSON.stringify({ replacement }));
        }

        // ── generate ─────────────────────────────────────────────────
        if (route === 'GET /api/transcripts') {
          const inputDir = join(cwd, 'input');
          const state = fs.loadState();
          const files = existsSync(inputDir)
            ? readdirSync(inputDir).filter((f) => f.endsWith('.txt') || f.endsWith('.md'))
            : [];
          const attendees = await granolaAttendees();
          const meta = loadMeta();
          const unprocessed = files
            .filter((f) => !fs.isFileProcessed(join(inputDir, f), state))
            .filter((f) => !loadMeta()[f]?.skipped)
            .filter((f) => f !== genActive && !genQueue.includes(f))
            .map((f) => {
              const st = statSync(join(inputDir, f));
              return {
                name: f,
                size: st.size,
                modified: st.mtime.toISOString(),
                attendees: attendees[f] || meta[f]?.attendees || [],
                summary: meta[f]?.summary || null,
              };
            })
            .sort((a, b) => b.name.localeCompare(a.name));
          // Persist attendees so they survive Granola auth hiccups
          let dirty = false;
          for (const t of unprocessed) {
            if (t.attendees.length && !meta[t.name]?.attendees) {
              meta[t.name] = { ...meta[t.name], attendees: t.attendees };
              dirty = true;
            }
          }
          if (dirty) await saveMeta(meta);
          return send(200, JSON.stringify({ transcripts: unprocessed }));
        }

        if (req.method === 'GET' && url.pathname === '/api/transcripts/content') {
          const name = basename(url.searchParams.get('name') || '');
          const file = join(cwd, 'input', name);
          if (!name || !existsSync(file)) return send(404, JSON.stringify({ error: 'transcript not found' }));
          return send(200, JSON.stringify({ content: readFileSync(file, 'utf8') }));
        }

        if (route === 'POST /api/transcripts/skip') {
          const { name } = await readBody() as { name: string };
          const key = basename(String(name));
          const meta = loadMeta();
          meta[key] = { ...meta[key], skipped: true };
          await saveMeta(meta);
          return send(200, JSON.stringify({ ok: true }));
        }

        if (route === 'GET /api/generate/status') {
          const job = jobs['generate'];
          return send(200, JSON.stringify({
            running: job?.running ?? false,
            active: genActive,
            queued: genQueue.length,
            lastLine: job?.log.filter((l) => l.trim()).slice(-1)[0] || '',
            error: job?.error || null,
          }));
        }

        if (route === 'POST /api/transcripts/summary') {
          const { name } = await readBody() as { name: string };
          const file = join(cwd, 'input', basename(String(name)));
          if (!existsSync(file)) return send(404, JSON.stringify({ error: 'transcript not found' }));
          const meta = loadMeta();
          if (meta[basename(String(name))]?.summary) {
            return send(200, JSON.stringify({ summary: meta[basename(String(name))].summary }));
          }
          const text = readFileSync(file, 'utf8').slice(0, 8000);
          // Haiku for cheap metadata — this is internal, not published content
          const { default: Anthropic } = await import('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const msg = await client.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 80,
            messages: [{
              role: 'user',
              content: `One sentence, max 20 words: what was this meeting about? No preamble.\n\n${text}`,
            }],
          });
          const block = msg.content.find((b) => b.type === 'text');
          const summary = (block && block.type === 'text' ? block.text : '').trim();
          meta[basename(String(name))] = { ...meta[basename(String(name))], summary };
          await saveMeta(meta);
          return send(200, JSON.stringify({ summary }));
        }

        if (route === 'POST /api/generate') {
          const { files } = await readBody() as { files: string[] };
          if (!Array.isArray(files) || files.length === 0) {
            return send(400, JSON.stringify({ error: 'no files selected' }));
          }
          const requested = files.map((f) => basename(String(f)));
          // Guard against double-processing: skip files already queued, active,
          // or being worked by an orphaned pre-restart child process
          const { execSync } = await import('child_process');
          const accepted = requested.filter((f) => {
            if (genQueue.includes(f) || genActive === f) return false;
            try {
              execSync(`pgrep -f "work --all --files ${f.replace(/[^a-zA-Z0-9._-]/g, '')}"`, { stdio: 'pipe' });
              return false; // an orphaned run is already on it
            } catch {
              return true; // pgrep found nothing
            }
          });
          if (accepted.length === 0) return send(409, JSON.stringify({ error: 'already processing' }));
          genQueue.push(...accepted);
          startJob('generate', async (job) => {
            let file: string | undefined;
            try {
              while ((file = genQueue.shift())) {
                const f = file;
                genActive = f;
                job.log.push(`▸ ${f}`);
                await new Promise<void>((resolve, reject) => {
                  const child = spawn(process.execPath, [process.argv[1], 'work', '--all', '--files', f], { cwd });
                  const onData = (chunk: Buffer) => {
                    stripAnsi(chunk.toString()).split('\n').forEach((line) => {
                      if (line.trim()) job.log.push(line.trimEnd());
                    });
                  };
                  child.stdout.on('data', onData);
                  child.stderr.on('data', onData);
                  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ship work exited with code ${code}`))));
                  child.on('error', reject);
                });
              }
            } finally {
              genActive = null;
            }
          });
          return send(202, JSON.stringify({ queued: genQueue.length }));
        }

        // ── reply ────────────────────────────────────────────────────
        if (route === 'POST /api/reply/scan') {
          const ok = startJob('reply', async (job) => {
            job.log.push('Connecting to X…');
            const { api, username } = await xApi();
            job.log.push(`Authenticated as @${username}`);
            const apiTier = config.x?.apiTier || 'free';
            const includeMetrics = apiTier === 'basic';
            const maxTweets = includeMetrics ? 30 : 10;
            job.log.push(`Fetching ${maxTweets} tweets…`);
            const tweets = await gatherReplyTweets(api, username, cwd, maxTweets, includeMetrics);
            if (tweets.length === 0) {
              job.result = { opportunities: [] };
              return;
            }
            job.log.push(`Analyzing ${tweets.length} tweets for reply opportunities…`);
            const styleGuide = fs.loadPrompt('style.md');
            const replyTemplate = fs.loadPrompt('reply.md');
            const llm = createLLMService(config);
            const response = await llm.generate(buildReplyPrompt(replyTemplate, styleGuide, tweets, includeMetrics));
            const opportunities = parseReplyOpportunities(response, tweets);
            job.log.push(`Found ${opportunities.length} opportunities`);
            job.result = {
              opportunities: opportunities.map((o) => ({
                tweetId: o.tweet.id,
                author: o.tweet.authorUsername || 'unknown',
                followers: o.tweet.authorFollowersCount || 0,
                text: o.tweet.text,
                likes: o.tweet.likeCount || 0,
                replies: o.tweet.replyCount || 0,
                retweets: o.tweet.retweetCount || 0,
                createdAt: o.tweet.createdAt,
                url: o.tweet.authorUsername
                  ? `https://x.com/${o.tweet.authorUsername}/status/${o.tweet.id}`
                  : `https://x.com/i/status/${o.tweet.id}`,
                suggestedReply: o.suggestedReply,
                reasoning: o.reasoning,
                parentText: o.parentTweet?.text,
                parentAuthor: o.parentTweet?.authorUsername,
              })),
            };
          });
          return ok
            ? send(202, JSON.stringify({ started: true }))
            : send(409, JSON.stringify({ error: 'scan already running' }));
        }

        if (route === 'POST /api/reply/post') {
          const { tweetId, text } = await readBody() as { tweetId: string; text: string };
          if (!tweetId || !text?.trim()) return send(400, JSON.stringify({ error: 'need tweetId and text' }));
          const { api } = await xApi();
          const posted = await api.postReply(tweetId, text.trim());
          try {
            await api.likeTweet(tweetId);
          } catch { /* best-effort like */ }
          logger.info(`Replied to ${tweetId}`);
          return send(200, JSON.stringify({ ok: true, url: `https://x.com/i/status/${posted.id}` }));
        }

        if (route === 'POST /api/reply/skip') {
          const { tweetId } = await readBody() as { tweetId: string };
          if (!tweetId) return send(400, JSON.stringify({ error: 'need tweetId' }));
          addToSkipCache(cwd, tweetId);
          return send(200, JSON.stringify({ ok: true }));
        }

        // ── stats ────────────────────────────────────────────────────
        if (route === 'GET /api/stats') {
          const clientId = config.x?.clientId;
          if (!clientId) return send(400, JSON.stringify({ error: 'X API not configured' }));
          if ((config.x?.apiTier || 'free') !== 'basic') {
            return send(400, JSON.stringify({ error: 'Stats requires Basic X API tier' }));
          }
          const auth = new XAuthService(cwd, clientId);
          const token = await auth.getValidToken();
          const api = new XApiService(token);
          const me = await api.getMe();
          const account = await getMeWithMetrics(token);

          const cacheFile = join(cwd, '.shippost-stats-cache.json');
          let tweets: TweetWithMetrics[] = [];
          let cached = false;
          if (existsSync(cacheFile)) {
            try {
              const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
              if (c.userId === me.id && Date.now() - c.timestamp < 60 * 60 * 1000) {
                tweets = c.tweets;
                cached = true;
              }
            } catch { /* ignore invalid cache */ }
          }
          if (!cached) {
            tweets = await getRecentTweetsWithMetrics(token, me.id, 100);
            const { writeFileSync } = await import('fs');
            writeFileSync(cacheFile, JSON.stringify({ tweets, timestamp: Date.now(), userId: me.id }));
          }

          const now = Date.now();
          const within = (days: number) => tweets.filter((t) => now - new Date(t.createdAt).getTime() < days * 86400000);
          const sum = (arr: TweetWithMetrics[]) => ({
            posts: arr.length,
            impressions: arr.reduce((s, t) => s + t.impressions, 0),
            likes: arr.reduce((s, t) => s + t.likes, 0),
            replies: arr.reduce((s, t) => s + t.replies, 0),
            retweets: arr.reduce((s, t) => s + t.retweets, 0),
            bookmarks: arr.reduce((s, t) => s + t.bookmarks, 0),
            engagementRate: arr.length ? arr.reduce((s, t) => s + t.engagementRate, 0) / arr.length : 0,
          });
          const d7 = sum(within(7));
          const dailyAvg = d7.impressions / 7;
          const topPost = [...within(7)].sort((a, b) => b.impressions - a.impressions)[0] || null;
          const bestHours = getHourlyEngagement(within(30))
            .sort((a, b) => b.avgEngagement - a.avgEngagement)
            .slice(0, 3)
            .map((h) => h.hour);

          return send(200, JSON.stringify({
            username: me.username,
            account,
            h24: sum(within(1)),
            d7,
            d30: sum(within(30)),
            goal: { target: 5_000_000, projected: Math.round(dailyAvg * 90), dailyAvg: Math.round(dailyAvg) },
            dailyPosts: getDailyPostCounts(tweets, 14),
            dailyImpressions: getDailyImpressions(tweets, 14),
            bestHours,
            topPost: topPost ? { text: topPost.text, impressions: topPost.impressions, likes: topPost.likes } : null,
            cached,
          }));
        }

        // ── unfollow ─────────────────────────────────────────────────
        if (route === 'POST /api/unfollow/scan') {
          const ok = startJob('unfollow-scan', async (job) => {
            job.log.push('Connecting to X…');
            const { api, username } = await xApi();
            job.log.push(`Authenticated as @${username}`);
            let following = loadFollowingCache(cwd);
            if (following) {
              job.log.push(`Using cached following list (${following.length})`);
            } else {
              job.log.push('Fetching following list (may take a minute)…');
              following = await api.getFollowing(6000);
              saveFollowingCache(cwd, following);
              job.log.push(`Fetched ${following.length} accounts`);
            }

            // Bios ride along on the following list (user.fields=description).
            // A cache from before bio support has none — try to refresh, but the
            // X monthly read cap (402) makes this best-effort.
            const haveBios = following.some((f) => f.bio !== undefined);
            if (following.length && !haveBios) {
              job.log.push('Cached following list predates bios — refetching…');
              try {
                following = await api.getFollowing(6000);
                saveFollowingCache(cwd, following);
                job.log.push(`Refetched ${following.length} accounts with bios`);
              } catch (err) {
                job.log.push(`⚠ Could not refetch bios (${(err as Error).message.split('\n')[0]}) — scoring on names/metrics only for now`);
              }
            }
            const biosAvailable = following.some((f) => f.bio !== undefined);
            const bios: Record<string, string> = {};
            for (const f of following) bios[f.id] = f.bio || '';

            // Relevance scores (permanent cache; score only new accounts)
            let relCache: Record<string, { score: number; note: string; username: string; bioScored?: boolean }> = {};
            try {
              relCache = JSON.parse(readFileSync(join(cwd, RELEVANCE_CACHE_FILE), 'utf8'));
            } catch { /* no cache yet */ }
            // Score new accounts; also rescore bio-less scores once bios arrive
            const unscored = following.filter((f) => !relCache[f.id] || (biosAvailable && !relCache[f.id].bioScored));
            if (unscored.length) {
              job.log.push(`Scoring relevance for ${unscored.length} accounts with Haiku…`);
              const { default: Anthropic } = await import('@anthropic-ai/sdk');
              const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
              const BATCH = 40;
              for (let i = 0; i < unscored.length; i += BATCH) {
                const batch = unscored.slice(i, i + BATCH);
                const listing = batch.map((a) =>
                  `${a.id} | @${a.username} | ${a.followersCount} followers, ${a.tweetCount} posts | ${(bios[a.id] || '(no bio)').replace(/\n/g, ' ').slice(0, 200)}`
                ).join('\n');
                const prompt =
                  `Ry follows these X accounts. His interests: ${RY_INTERESTS}.\n` +
                  `For each account, score 0-100 how relevant it is for him to keep following ` +
                  `(0 = spam/crypto-giveaway/irrelevant, 50 = unclear, 100 = squarely his world), ` +
                  `with a note of at most 6 words. A missing bio is NOT evidence of irrelevance — ` +
                  `if you cannot tell who they are, score 45-55, never 0.\n` +
                  `Return ONLY a JSON array: [{"id":"...","score":N,"note":"..."}]\n\n${listing}`;
                try {
                  const msg = await client.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 4000,
                    messages: [{ role: 'user', content: prompt }],
                  });
                  const block = msg.content.find((b) => b.type === 'text');
                  const text = block && block.type === 'text' ? block.text : '[]';
                  const arr = parseJsonFromResponse(text, isRelevanceScoreResults, 'array') || [];
                  for (const r of arr) {
                    const acct = batch.find((a) => a.id === r.id);
                    if (acct) {
                      relCache[acct.id] = { score: r.score, note: String(r.note || ''), username: acct.username, bioScored: biosAvailable };
                    }
                  }
                } catch (err) {
                  job.log.push(`scoring batch failed: ${(err as Error).message}`);
                }
                // Save after every batch so restarts don't lose progress
                const { writeFileSync } = await import('fs');
                writeFileSync(join(cwd, RELEVANCE_CACHE_FILE), JSON.stringify(relCache, null, 2));
                job.log.push(`Scored ${Math.min(i + BATCH, unscored.length)}/${unscored.length}`);
              }
            } else {
              job.log.push('All accounts already relevance-scored');
            }

            // Protect accounts that actually show up in Ry's feed (seen in last 30 days)
            const feedSeen = loadFeedSeen(cwd);
            const feedCutoff = Date.now() - 30 * 86400000;
            const seenRecently = (id: string) =>
              feedSeen[id] !== undefined && new Date(feedSeen[id]).getTime() > feedCutoff;

            const whitelist = loadWhitelist(cwd);
            const pendingUnf = loadPendingUnfollows(cwd);
            const eligible = following.filter((a) => !pendingUnf[a.id] && !whitelist[a.id] && !seenRecently(a.id));

            const qualityCands = new Map(buildCandidates(eligible, { minFollowers: 500 }).map((c) => [c.id, c]));
            const combined = eligible
              .map((a) => {
                const rel = relCache[a.id];
                const quality = qualityCands.get(a.id);
                const lowRelevance = rel !== undefined && rel.score < 30;
                if (!quality && !lowRelevance) return null;
                const reasons: string[] = [];
                if (quality) reasons.push(quality.reason);
                if (rel && rel.score < 50) reasons.push(`relevance ${rel.score}${rel.note ? ': ' + rel.note : ''}`);
                return {
                  id: a.id,
                  username: a.username,
                  name: a.name,
                  followers: a.followersCount,
                  tweets: a.tweetCount,
                  relevance: rel?.score ?? null,
                  reason: reasons.join(' · '),
                };
              })
              .filter((c): c is NonNullable<typeof c> => c !== null)
              .sort((a, b) => (a.relevance ?? 50) - (b.relevance ?? 50) || a.followers - b.followers);

            job.result = {
              followingCount: following.length,
              pendingCount: Object.keys(pendingUnf).length,
              candidates: combined.slice(0, 200),
            };
          });
          return ok
            ? send(202, JSON.stringify({ started: true }))
            : send(409, JSON.stringify({ error: 'scan already running' }));
        }

        if (route === 'POST /api/unfollow/whitelist') {
          const { entries } = await readBody() as { entries: { id: string; username: string }[] };
          if (!Array.isArray(entries) || entries.length === 0) return send(400, JSON.stringify({ error: 'no accounts selected' }));
          addToWhitelist(cwd, entries.map((e) => ({ id: String(e.id), username: String(e.username || '') })));
          return send(200, JSON.stringify({ ok: true, count: entries.length }));
        }

        if (route === 'POST /api/unfollow/run') {
          const { ids, entries } = await readBody() as { ids?: string[]; entries?: { id: string; username: string }[] };
          const toAdd = entries?.length
            ? entries.map((e) => ({ id: String(e.id), username: String(e.username || '') }))
            : (ids || []).map((id) => ({ id: String(id), username: '' }));
          if (toAdd.length === 0) return send(400, JSON.stringify({ error: 'no accounts selected' }));
          const pending = loadPendingUnfollows(cwd);
          const now = new Date().toISOString();
          for (const e of toAdd) pending[e.id] = { username: e.username, queuedAt: now };
          await savePendingUnfollows(cwd, pending);
          runUnfollowWorker();
          return send(202, JSON.stringify({ pending: Object.keys(pending).length }));
        }

        if (route === 'POST /api/unfollow/retry') {
          const pending = loadPendingUnfollows(cwd);
          if (Object.keys(pending).length === 0) return send(200, JSON.stringify({ pending: 0 }));
          runUnfollowWorker();
          return send(202, JSON.stringify({ pending: Object.keys(pending).length }));
        }

        send(404, JSON.stringify({ error: 'not found' }));
      } catch (error) {
        send(500, JSON.stringify({ error: (error as Error).message }));
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      logger.blank();
      logger.success(`ship ui running at ${url}`);
      logger.info('  Review • Generate • Reply • Stats • Unfollow — Ctrl-C here when done');
      const pending = Object.keys(loadPendingUnfollows(cwd)).length;
      if (pending > 0) {
        logger.info(`  ${pending} pending unfollow decision${pending === 1 ? '' : 's'} — retrying`);
        runUnfollowWorker();
      }
      exec(`open ${url}`);
    });
  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
