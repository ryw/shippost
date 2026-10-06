# shippost

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Version 2026.8.1](https://img.shields.io/badge/version-2026.8.1-orange.svg)](package.json)

> **Transform meeting transcripts and notes into engaging social media posts with AI**

shippost is a human-in-the-loop CLI tool that processes your content into social media post ideas. Keep your workflow local and private with Ollama, or leverage Anthropic Claude for enhanced quality.

**CLI command:** `ship`

---

## Table of Contents

- [Why shippost?](#why-shippost)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Content Strategies](#content-strategies)
- [Typefully Integration](#typefully-integration)
- [X (Twitter) Integration](#x-twitter-integration)
- [Customizing Prompts](#customizing-prompts)
- [Community Style Examples](#community-style-examples)
- [Tips & Best Practices](#tips--best-practices)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Why shippost?

| Feature | shippost | Manual Writing | Other Tools |
|---------|----------|----------------|-------------|
| **Privacy** | Local LLM support (Ollama) | ✓ | Cloud-only |
| **Human-in-the-loop** | Review before posting | ✓ | Often auto-posts |
| **Style consistency** | Learns your voice | Manual effort | Generic |
| **Content strategies** | 64 proven formats | Ad-hoc | Limited |
| **Integrations** | Typefully + X API | N/A | Varies |

### Key Features

- **Flexible LLM Providers** — Ollama (local, private) or Claude (cloud, high-quality)
- **64 Content Strategies** — Proven post formats for maximum variety
- **Customizable Style** — Define your brand voice in editable prompt files
- **X Post Analysis** — Auto-generate style guides from your existing tweets
- **Reply Guy Mode** — Find and reply to tweets from your timeline
- **Typefully Integration** — Stage posts directly as drafts
- **Banger Scoring** — Each post scored 1-99 for viral potential

---

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **LLM Provider** (choose one):
  - [Ollama](https://ollama.ai) — Local, free, private
  - [Anthropic Claude](https://console.anthropic.com/) — Cloud, paid, high-quality

### Installation

```bash
git clone <repo-url>
cd shippost
npm install && npm run build
npm link  # Makes 'ship' command available globally
```

### First Run

```bash
# Initialize a new project
ship init

# Add your content
cp ~/meeting-notes.txt input/

# Generate posts
ship work

# Review generated posts, then stage approved posts to Typefully
ship review
```

That's it! Your posts are in `posts.jsonl`, ready for review.

---

## Commands

### Quick Reference

| Command | Description |
|---------|-------------|
| `ship init` | Initialize project structure |
| `ship work` | Generate posts from input files |
| `ship posts` | View generated posts |
| `ship ui` | Local web app for the whole pipeline |
| `ship review` | Interactively approve/reject generated posts |
| `ship analyze-x` | Generate style guide from your tweets |
| `ship reply` | Find and post replies on X |
| `ship x-status` | Check X API rate limits |
| `ship stats` | X metrics dashboard (Basic tier) |
| `ship sync-prompts` | Update prompts to latest defaults |

---

### `ship init`

Initialize a new ship project in the current directory.

**Creates:**

| Path | Description |
|------|-------------|
| `.shippostrc.json` | Project configuration |
| `input/` | Directory for source content |
| `prompts/style.md` | Your posting style and voice |
| `prompts/work.md` | Post generation instructions |
| `prompts/system.md` | System prompt (advanced) |
| `prompts/analysis.md` | Style analysis prompt (advanced) |
| `prompts/content-analysis.md` | Strategy selection (advanced) |
| `prompts/banger-eval.md` | Viral scoring criteria (advanced) |
| `prompts/reply.md` | Reply analysis (advanced) |
| `strategies.json` | Customizable content strategies |

---

### `ship work`

Process all files in `input/` and generate posts.

```bash
# Basic usage (auto-selects 8 diverse strategies)
ship work

# List available strategies
ship work --list-strategies
ship work --list-strategies --category educational

# Use specific strategies
ship work --strategy personal-story
ship work --strategies "how-to-guide,bold-observation,resource-list"

# More options
ship work --count 12           # Generate 12 posts per file
ship work --model llama3.1     # Use specific model
ship work --force              # Reprocess all files
ship work --verbose            # Detailed output
ship work --no-strategies      # Legacy mode (no strategies)
```

**Options:**
- `--target <social|blog|revisions>` — Select output (default: social)
- `--sync` — Explicitly sync Granola before generation
- `-m, --model <model>` — Override the LLM model
- `-v, --verbose` — Show detailed processing info
- `-f, --force` — Force reprocessing for the selected target
- `-c, --count <n>` — Posts to generate per file (default: 8)
- `-s, --strategy <id>` — Use specific strategy
- `--strategies <ids>` — Multiple strategies (comma-separated)
- `--list-strategies` — List all strategies
- `--category <name>` — Filter strategies by category
- `--no-strategies` — Disable strategy system

**How it works:**
1. Validates environment (LLM provider, required files)
2. Loads your style guide and instructions
3. Scans `input/` for `.txt` and `.md` files
4. Skips already-processed files (use `--force` to override)
5. Generates posts using selected strategies
6. Scores each post for viral potential
7. Saves to `posts.jsonl`

> **Note:** Tracking in `.shippost-state.json` prevents repeated generation per source and target. Use `--force` to explicitly regenerate modified inputs.

---

### `ship posts`

View generated posts with filtering options.

```bash
ship posts                      # Last 10 posts
ship posts -n 20                # Last 20 posts
ship posts --strategy "personal-story"
ship posts --min-score 70       # High-quality only
ship posts --source "meeting"   # Filter by source file
ship posts --eval               # Score posts missing scores
```

**Options:**
- `-n, --count <n>` — Number of posts to show (default: 10)
- `--strategy <name>` — Filter by strategy
- `--min-score <n>` — Minimum banger score
- `--source <text>` — Filter by source filename
- `--eval` — Evaluate unscored posts

---

### `ship ui`

Local web app (http://127.0.0.1:4747) covering the whole pipeline in five tabs. `ship review --web` opens the same app.

```bash
ship ui                         # Start the app and open the browser
ship ui --port 5000             # Custom port
ship ui --min-score 60          # Filter the review queue
```

**Tabs:**
- **Generate** — card per unprocessed transcript with attendees and a one-line summary; `p` process / `k` skip. Processing queues sequentially with a live status line; skips persist.
- **Review** — score-sorted queue; `a` approve, `r` reject, `e` edit, `k` skip, `⌘s` approve while editing. Select text and hit `tab` to have the LLM rewrite just that span in your voice. Edits persist per post until decided. Typefully staging is a separate action for approved posts.
- **Reply** — scan your timeline for reply opportunities, edit inline, post + like or skip.
- **Stats** — account tiles, 7-day metrics, 90-day goal progress, top post.
- **Unfollow** — candidates ranked by LLM relevance to your interests plus quality signals, protected by a feed-presence check and a whitelist. Unfollow decisions persist to disk and retry automatically if you hit X API limits.

The server is localhost-only. Jobs (generation, scans, unfollows) run server-side, so you can close the tab and come back.

---

### `ship review`

Interactively review posts and approve or reject them. Approved posts can be staged to Typefully from `ship ui` after content review.

```bash
ship review                     # Review all new posts
ship review --min-score 70      # Only high-quality posts
```

**Actions during review:**
- `a` — Approve for staging
- `r` — Reject
- `q` — Quit

**Post statuses:**
- `new` — Not yet reviewed
- `keep` — Saved for later
- `approved` — Content-reviewed and ready to stage
- `staged` — Sent to Typefully
- `rejected` — Filtered out
- `published` — Reserved for future

---

### `ship analyze-x`

Generate a personalized style guide by analyzing your X posts.

```bash
ship analyze-x                  # Analyze 33 tweets (default)
ship analyze-x --count 100      # More tweets for deeper analysis
ship analyze-x --overwrite      # Replace existing analysis
ship analyze-x --setup          # Reconfigure X API credentials
```

**Requirements:**
- Free X Developer account ([sign up](https://developer.x.com/))
- OAuth 2.0 app with redirect URI: `http://127.0.0.1:9876/callback`
- Scopes: `tweet.read`, `users.read`, `offline.access`

**First-time setup:**
1. Create app at [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Enable OAuth 2.0
3. Set redirect URI to `http://127.0.0.1:9876/callback`
4. Run `ship analyze-x` and enter your Client ID

> **Rate limits:** Free tier allows 100 reads/month. Upgrade to Basic ($200/month) for 10,000 reads.

---

### `ship reply`

Find tweets from accounts you follow and generate contextual replies.

```bash
ship reply                      # Analyze 10 tweets
ship reply --count 20           # Analyze more tweets
```

**Actions during review:**
- `Enter` — Post the reply
- `e` — Edit before posting
- `n` — Skip this tweet
- `q` — Quit

**Requirements:**
- Same X API setup as `ship analyze-x`
- App must have "Read and Write" permissions
- Additional scope: `tweet.write`

> **Basic tier features ($200/month):** Tweets sorted by author follower count, shows engagement metrics.

---

### `ship x-status`

Check X API rate limits and account info.

```bash
ship x-status
```

Shows: connected account, API tier, rate limit status with progress bars, and reset times.

---

### `ship stats`

Comprehensive X metrics dashboard. **Requires X API Basic tier ($200/month).**

```bash
ship stats
```

Shows: follower counts, posting activity, impressions with sparklines, 90-day goal progress, engagement metrics, best posting times, and top performing posts.

---

### `ship sync-prompts`

Update local prompts to latest package defaults.

```bash
ship sync-prompts               # Interactive update
ship sync-prompts --force       # Update all without prompting
```

---

## Configuration

Configuration is stored in `.shippostrc.json`.

### Using Ollama (default)

```json
{
  "llm": {
    "provider": "ollama"
  },
  "ollama": {
    "host": "http://127.0.0.1:11434",
    "model": "llama3.1",
    "timeout": 60000
  },
  "generation": {
    "postsPerTranscript": 8,
    "temperature": 0.7,
    "strategies": {
      "enabled": true,
      "autoSelect": true,
      "diversityWeight": 0.7,
      "preferThreadFriendly": false
    }
  }
}
```

### Using Anthropic Claude

```json
{
  "llm": {
    "provider": "anthropic"
  },
  "anthropic": {
    "model": "claude-sonnet-5-5",
    "maxTokens": 4096
  },
  "generation": {
    "postsPerTranscript": 8
  },
  "typefully": {
    "socialSetId": "1"
  }
}
```

Set API keys in `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
TYPEFULLY_API_KEY=your-typefully-api-key-here
```

See [ANTHROPIC_SETUP.md](ANTHROPIC_SETUP.md) for detailed Claude setup.

### All Options

| Option | Default | Description |
|--------|---------|-------------|
| `llm.provider` | `ollama` | `ollama` or `anthropic` |
| `ollama.host` | `http://127.0.0.1:11434` | Ollama server URL |
| `ollama.model` | `llama3.1` | Ollama model |
| `ollama.timeout` | `60000` | Request timeout (ms) |
| `anthropic.model` | `claude-sonnet-5-5` | Claude model |
| `anthropic.maxTokens` | `4096` | Max response tokens |
| `generation.postsPerTranscript` | `8` | Posts per input file |
| `generation.temperature` | `0.7` | Sampling (0.0-1.0); omitted for newer Claude models |
| `generation.strategies.enabled` | `true` | Enable strategies |
| `generation.strategies.autoSelect` | `true` | Auto-select strategies |
| `generation.strategies.diversityWeight` | `0.7` | Category diversity (0.0-1.0) |
| `generation.strategies.preferThreadFriendly` | `false` | Prefer thread strategies |
| `x.clientId` | — | X API OAuth Client ID |
| `x.apiTier` | `free` | `free` or `basic` |
| `typefully.socialSetId` | `"1"` | Typefully Social Set ID |

---

## Content Strategies

shippost includes **64 proven content strategies** inspired by Typefully's successful formats. Each strategy provides a unique angle for presenting your ideas.

### What Are Strategies?

Instead of generic posts, shippost applies specific frameworks:
- **Personal Story** — Share experiences and transformations
- **How-To Guide** — Step-by-step instructions
- **Bold Observation** — Provocative statements that capture attention
- **Before & After** — Show transformation or progress
- **Resource Thread** — Curate valuable tools or links
- **Behind-the-Scenes** — Show your process

### Categories

| Category | Description |
|----------|-------------|
| **Personal** | Stories, experiences, transformations |
| **Educational** | How-tos, frameworks, tips |
| **Provocative** | Bold statements, contrarian takes |
| **Engagement** | Questions, polls, thought experiments |
| **Curation** | Lists, recommendations, resources |
| **Behind-the-Scenes** | Process, WIP, building |
| **Reflective** | Lessons learned, retrospectives |

### How It Works

1. **Content Analysis** — Analyzes your transcript for characteristics (personal stories, actionable advice, strong opinions)
2. **Strategy Selection** — Selects applicable strategies ensuring category diversity
3. **Post Generation** — Each post follows one strategy's format

### Customizing Strategies

Edit `strategies.json` to add, modify, or remove strategies:

```json
{
  "id": "weekly-reflection",
  "name": "Weekly Reflection Post",
  "prompt": "Share a key lesson from this week. What did you learn?",
  "category": "reflective",
  "threadFriendly": false,
  "applicability": {
    "worksWithAnyContent": true
  }
}
```

**Applicability flags:**
- `requiresPersonalNarrative` — Needs personal stories
- `requiresActionableKnowledge` — Needs how-to content
- `requiresResources` — Needs tool/book mentions
- `requiresProject` — Needs project context
- `requiresStrongOpinion` — Needs strong viewpoints
- `worksWithAnyContent` — Always applicable

---

## Typefully Integration

Stage posts directly to [Typefully](https://typefully.com/) drafts.

### Setup

1. Get API key: Typefully → Settings → Integrations
2. Add to `.env`:
   ```bash
   TYPEFULLY_API_KEY=your-api-key-here
   ```
3. (Optional) Configure Social Set ID for multi-account setups

### Usage

```bash
# Review posts and approve the best ones
ship review --min-score 70

# Stage approved posts from the web UI
ship ui
```

Approving a post in the Review tab automatically sends the edited content to Typefully as an unpublished draft. If sending fails, the approval and edits stay saved; use **Retry send** to try again. Terminal review still saves approval locally for later staging.

> **Note:** Posts are created as drafts, not published. Requires Typefully Pro plan.

---

## X (Twitter) Integration

### Setup

1. Create app at [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Enable OAuth 2.0
3. Set redirect URI: `http://127.0.0.1:9876/callback`
4. For `ship reply`: Enable "Read and Write" permissions

### API Tiers

| Feature | Free | Basic ($200/mo) |
|---------|------|-----------------|
| Analyze tweets | ✓ (100/mo) | ✓ (10,000/mo) |
| Post replies | ✓ | ✓ |
| Follower counts | — | ✓ |
| Sort by influence | — | ✓ |
| Stats dashboard | — | ✓ |

Configure tier in `.shippostrc.json`:
```json
{
  "x": {
    "clientId": "your-client-id",
    "apiTier": "basic"
  }
}
```

### Rate Limit Tips

- Free tier: ~15 requests per 15 minutes
- Use `--count 10` or less for `ship reply`
- Check status with `ship x-status`

---

## Customizing Prompts

All prompts are stored as editable markdown files in `prompts/`.

### Core Prompts

| File | Purpose | When to Edit |
|------|---------|--------------|
| `style.md` | Brand voice, tone, examples | Voice not right, want different tone |
| `work.md` | Generation instructions | Posts need different structure |

### Advanced Prompts

| File | Purpose |
|------|---------|
| `system.md` | System prompt wrapper |
| `analysis.md` | X post style analysis |
| `content-analysis.md` | Strategy selection criteria |
| `banger-eval.md` | Viral scoring criteria |
| `reply.md` | Reply opportunity analysis |

### Benefits

- **No code changes** — Customize by editing markdown
- **Version controlled** — Track prompt changes in git
- **Project-specific** — Each project can have unique prompts

---

## Community Style Examples

Learn from real `style.md` files in `community-examples/style/`.

```bash
# Browse examples
ls community-examples/style/

# Use as starting point
cp community-examples/style/example-technical-founder.md prompts/style.md
```

### Contributing

Share your style.md:
1. Copy to `community-examples/style/your-name.md`
2. Remove sensitive information
3. Add context at the top
4. Submit a PR

---

## Tips & Best Practices

### Content Quality

- Use well-structured transcripts with clear sections
- Remove filler words for better results
- Longer transcripts (500+ words) generate better insights

### LLM Models

**Ollama:**
- `llama3.1` — Good balance (default)
- `llama2` — Faster iterations
- `mixtral` — More creative

**Anthropic:**
- `claude-sonnet-5-5` — Best balance (recommended)
- `claude-haiku-4-5-20251001` — Fastest
- `claude-opus-5-5` — Complex coding and knowledge work
- `claude-fable-5-1` — Demanding reasoning

### Strategies

- Let auto-selection work for most transcripts
- Use `--count 12` for longer transcripts
- Analyze which strategies perform best using scores
- Experiment with `diversityWeight` config

### Output Management

```bash
# Filter posts with jq
cat posts.jsonl | jq 'select(.metadata.bangerScore > 70)'

# Group by strategy
cat posts.jsonl | jq -r '.metadata.strategy.category' | sort | uniq -c

# Find best strategy
cat posts.jsonl | jq -r 'select(.metadata.bangerScore > 70) | .metadata.strategy.name' | sort | uniq -c | sort -rn
```

---

## Troubleshooting

### Ollama Issues

**"Ollama is not available"**
```bash
# Install from https://ollama.ai
ollama serve              # Start server
curl http://localhost:11434  # Verify
```

**"Model not found"**
```bash
ollama pull llama3.1
```

### Anthropic Issues

**"API key not found"**

Add to `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**"API not available"**
- Check API key validity
- Verify account has credits
- Check [status.anthropic.com](https://status.anthropic.com/)

### X API Issues

**403 errors when posting:**
1. Change app to "Read and write" at [Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Delete `.shippost-tokens.json`
3. Re-authenticate

**429 rate limit errors:**
- Wait 15 minutes
- Use `--count 10` or less
- Check `ship x-status`

### General Issues

**"Not a ship project"**
```bash
ship init
```

**Configuration errors**

Ensure `.shippostrc.json` is valid JSON with required fields.

---

## Development

```bash
npm install               # Install dependencies
npm run dev               # Development mode
npm run build             # Build TypeScript
npm link                  # Link globally for testing
```

### Project Structure

```
src/
├── index.ts              # CLI entry point
├── commands/             # Command implementations
├── types/                # TypeScript types
├── services/             # LLM, X API, Typefully integrations
└── utils/                # Helpers (logging, validation, etc.)
```

### Issue Tracking

Issues are tracked on GitHub (`gh issue list`). See `AGENTS.md` for workflow.

---

## Output Format

Posts are stored in `posts.jsonl`:

```json
{
  "id": "uuid",
  "sourceFile": "input/meeting.txt",
  "content": "Your generated post...",
  "metadata": {
    "model": "llama3.1",
    "temperature": 0.7,
    "strategy": {
      "id": "personal-story",
      "name": "Personal Story",
      "category": "personal"
    },
    "bangerScore": 75,
    "bangerEvaluation": {
      "score": 75,
      "breakdown": { "hook": 18, "emotional": 16, "..." : "..." },
      "reasoning": "Strong opening hook..."
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "status": "new"
}
```

### Banger Score

Each post is scored 1-99 for viral potential:

| Score | Potential |
|-------|-----------|
| 1-29 | Low |
| 30-49 | Below average |
| 50-69 | Average |
| 70-84 | High |
| 85-99 | Exceptional |

**Scoring factors:**
1. Hook Strength (20 pts)
2. Emotional Resonance (20 pts)
3. Value & Shareability (15 pts)
4. Format & Structure (15 pts)
5. Relevance & Timing (10 pts)
6. Engagement Potential (10 pts)
7. Authenticity & Voice (10 pts)

---

## Getting Transcripts from Granola

[Granola](https://www.granola.ai/) is an AI meeting transcription tool.

### Methods

1. **Manual Copy:** Click transcription button → copy → `pbpaste > input/meeting.txt`
2. **Chrome Extension:** [Granola Transcriber](https://chromewebstore.google.com/detail/granola-transcriber/apoblbmhjjnfcefcmlidblklbjepfiin)
3. **Raycast Extension:** [Granola for Raycast](https://www.raycast.com/Rob/granola) (bulk export)

### Tips

- Use descriptive filenames: `YYYY-MM-DD-topic.txt`
- Clean transcripts before exporting for better quality
- Batch process multiple meetings at once

---

## Roadmap

### Completed (v0.1.0)
- [x] `ship init`, `ship work`, `ship posts`, `ship review`
- [x] `ship analyze-x`, `ship reply`, `ship x-status`, `ship stats`
- [x] Typefully integration
- [x] 64 content strategies
- [x] Banger scoring

### Planned
- [ ] `ship analyze` — Success metrics (X Basic API)
- [ ] News-aware post generation
- [ ] LinkedIn support
- [ ] Multiple output formats (CSV, Markdown)
- [ ] Bulk staging command

---

## License

MIT

### Separate generation targets

`ship work` now defaults to social posts only. It does not generate blog drafts, change articles, or sync Granola automatically. Existing flags such as `--files`, `--all`, `--count`, and strategy options still apply; `--count` controls social post generation.

```bash
ship work --target social --all --files meeting.txt
ship work --target blog --all --files meeting.txt
ship work --target revisions --all --files meeting.txt
ship work --sync --target social  # explicitly sync Granola first
```

The Generate tab offers **Generate all 3**: one click runs social posts, blog drafts, and article revision proposals sequentially. A failed output does not stop the other types; retrying runs only unfinished types. Sources stay in the queue until every type is completed or skipped. Skip applies to all types. The separate **Sync Granola** button imports sources. CLI target selection remains available for individual runs.

Completion is tracked per source and target in `.shippost-state.json`. Newly generated social posts do not prevent a later blog run. Existing records without target metadata are treated as completed for all targets to avoid silently regenerating historical content; use `--force --target blog --files meeting.txt` to explicitly rerun one target. A failed target stays retryable without rerunning other completed targets. Social strategy output is held until the full batch succeeds, so a model failure does not save a partial social batch. File writes and completion tracking are not a distributed transaction: inspect saved outputs after a process crash before forcing a retry.

Blog runs create new drafts and use a fresh slug when a draft, article, or cover already exists. Revision runs save proposals in local `.shippost-revisions/`, with the original article path, its SHA-256 hash, and the source reference in a companion JSON file. Original articles remain unchanged. Review the proposal against the original, confirm the original hash still matches, then manually apply the chosen edits and run the site's checks before publication. There is no automatic apply/publish action. Repeated or interrupted revision runs may produce multiple proposals; review them before applying.

Revision instructions live in `prompts/blog-revision.md`, created by `ship init`. For an existing workspace, copy `src/templates/blog-revision.md` from the Shippost checkout (or `dist/templates/blog-revision.md` from its package) into your workspace's `prompts/` directory and customize it.

### Configure everything from Settings

Run `ship ui` from the content workspace and open the **Settings** tab. A workspace with no local config opens Settings automatically; you do not need to run `ship init` or edit JSON. Saving creates missing prompts, input directory, strategies, and posts file while preserving existing editorial files. It also creates a missing revision prompt in an existing workspace.

Settings covers the LLM provider, model and server, output/token limits, temperature, strategy options, Typefully social set, X client ID/tier, and blog/image output paths. **Test saved LLM connection** uses the saved settings and may make a small billable provider request. Saving alone does not call a provider, stage drafts, publish content, or authorize an X account. X OAuth authorization still uses the existing `ship analyze-x --setup` flow; Granola API keys can be saved under Credentials.

API keys and the X client secret can be entered, replaced, or removed in the browser. They are stored in local `.shippost-secrets.json` with owner-only permissions, loaded by CLI commands and generation workers, and never sent back in settings responses. Blank credential fields keep existing values; explicit removal clears a saved value. Existing Anthropic keys in local config migrate to the separate credentials file on save. Both files stay ignored by Git; ignore rules do not remove files already tracked elsewhere. Environment-provided credentials and account overrides take precedence and appear as managed fields.

Changes apply on the next operation, and cached provider clients reset after saving. Settings changes are blocked while background jobs or Typefully staging are active. Settings access is restricted to the localhost origin and saves require a per-server browser token. This is a local UI, not an authenticated public deployment: use the local browser until authenticated remote access is implemented.

Anthropic model suggestions were refreshed against the [current model overview](https://platform.claude.com/docs/en/about-claude/models/overview) on October 5, 2026: Sonnet 5.5 (new-workspace default), Opus 5.5, Fable 5.1, and Haiku 4.5. Existing explicit model choices are preserved, and you can enter another model ID. Settings hides temperature for newer or unrecognized Claude models; the request also omits it, even when an older config has a temperature value. Known compatible legacy models (including Haiku 4.5) and Ollama retain the control. Anthropic recommends omitting sampling parameters for newer models in its [migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide). Generated-post metadata omits temperature when it was not sent.

The Generate tab defaults to **Past 30 days**: today and the preceding 29 UTC calendar dates, using recorded meeting dates or the date prefix in imported filenames. Copying a file does not make an old meeting recent. Older, future-dated, and undated sources remain accessible through **All dates**. This filters the local queue; use **Sync Granola** to import recent notes. An empty recent queue means recent meetings may still need importing.

### Granola API key sync

In Settings → Credentials, save a **Granola API key** with Personal notes access (Business or Enterprise plan). Then use Generate → **Sync Granola**. The official API importer fetches notes created within the past 30 UTC calendar dates, including private written notes and AI summaries; it does not fetch full transcripts. Notes are identified by stable Granola IDs, paginated, saved locally, and checkpointed after each successful import. Empty or failed notes stay retryable. Already imported notes are skipped; CLI `--force` explicitly refreshes them. API failures do not fall back to desktop credentials.

The CLI uses the same importer when `GRANOLA_API_KEY` is saved in the workspace or set in the environment. Without a key, the CLI retains the legacy macOS desktop importer. The UI requires an API key and does not need Granola installed on the server. Keys use the same ignored, owner-only credential file as the other integrations and are never returned to the browser.

To suspend X integration, turn off **Settings → X → Enable X API access**. This blocks OAuth and X API clients, including replies, unfollows, and analytics, for the workspace. Credentials and queued unfollow decisions are retained; pending decisions only run after explicit Retry. Granola imports and local content generation remain available.

### Grok subscription provider

Select **grok** in Settings, click **Connect Grok**, then open the sign-in link and enter the displayed code. This uses your SuperGrok subscription through device-code OAuth, following [OpenCode's subscription integration](https://github.com/anomalyco/opencode/blob/772392050500e0ddcd2ad2193411a22a3824372f/packages/opencode/src/plugin/xai.ts). No Grok Build installation or pay-as-you-go API key is required. Save the provider and model; the default is `grok-4.7`.

Shippost sends requests directly to the Responses endpoint with your subscription token. It supplies no tools, does not launch a coding agent, does not use the X/Twitter API, and ignores `XAI_API_KEY`. Temperature is not sent. Reasoning effort defaults to **high**; choose low, medium, high, or xhigh in Settings. Subscription eligibility, allowance, and billing remain controlled by your Grok account.

Tokens are stored in the private `.shippost-grok/subscription.json` file with owner-only permissions, refreshed automatically, and never returned to the browser. An existing workspace Grok Build sign-in is imported automatically; use **Reconnect Grok** if it expires or you continue using another client with the old sign-in. Keep `.shippost-grok/` ignored by Git. Existing prompts remain editable and the three-output workflow is unchanged.

References: [OpenCode provider documentation](https://opencode.ai/docs/providers/#xai) and [Grok subscription usage](https://docs.x.ai/grok/faq).

Grok request diagnostics are recorded privately in `.shippost-grok/requests.jsonl`: request purpose, duration, outcome, prompt fingerprint/character count, and token/cache/reasoning counts when returned by the provider. Prompts, response text, credentials, and raw errors are not logged. Diagnostics do not change reasoning effort or trigger extra requests.
