# shippost

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-orange.svg)](package.json)

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

# Review and stage to Typefully
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
| `ship review` | Interactively review and stage posts |
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
- `-m, --model <model>` — Override the LLM model
- `-v, --verbose` — Show detailed processing info
- `-f, --force` — Force reprocessing of all files
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

> **Note:** File tracking in `.ship-state.json` prevents duplicate processing. Modified files are automatically reprocessed.

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

### `ship review`

Interactively review posts and decide their fate. Posts are sorted by banger score (highest first).

```bash
ship review                     # Review all new posts
ship review --min-score 70      # Only high-quality posts
```

**Actions during review:**
- `s` — Stage to Typefully (creates draft)
- `Enter` — Keep for later
- `n` — Reject
- `q` — Quit

**Post statuses:**
- `new` — Not yet reviewed
- `keep` — Saved for later
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
- OAuth 2.0 app with redirect URI: `http://127.0.0.1:3000/callback`
- Scopes: `tweet.read`, `users.read`, `offline.access`

**First-time setup:**
1. Create app at [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Enable OAuth 2.0
3. Set redirect URI to `http://127.0.0.1:3000/callback`
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
    "model": "claude-sonnet-4-5-20250514",
    "maxTokens": 4096
  },
  "generation": {
    "postsPerTranscript": 8,
    "temperature": 0.7
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
| `anthropic.model` | `claude-3-5-sonnet-20241022` | Claude model |
| `anthropic.maxTokens` | `4096` | Max response tokens |
| `generation.postsPerTranscript` | `8` | Posts per input file |
| `generation.temperature` | `0.7` | Creativity (0.0-1.0) |
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
# Review posts and stage the best ones
ship review --min-score 70
```

Press `s` during review to stage a post. The draft URL is displayed for quick access.

> **Note:** Posts are created as drafts, not published. Requires Typefully Pro plan.

---

## X (Twitter) Integration

### Setup

1. Create app at [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Enable OAuth 2.0
3. Set redirect URI: `http://127.0.0.1:3000/callback`
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
- `claude-sonnet-4-5-20250514` — Best balance (recommended)
- `claude-3-5-haiku-20241022` — Fastest
- `claude-3-opus-20240229` — Most capable

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

Uses [bd (beads)](https://github.com/steveyegge/beads). See `AGENTS.md` for workflow.

```bash
bd list          # View all issues
bd ready         # See unblocked work
bd create "..."  # Create new issue
```

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
