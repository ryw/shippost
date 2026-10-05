# Using Anthropic (Claude) with ship

This guide explains how to configure ship to use Anthropic's Claude models instead of local Ollama.

## Prerequisites

- An Anthropic API key (get one at https://console.anthropic.com/)

## Setup

### 1. Configure the Provider

Edit your `.shiprc.json` file and change the provider to `anthropic`:

```json
{
  "llm": {
    "provider": "anthropic"
  },
  "anthropic": {
    "model": "claude-sonnet-5-5",
    "maxTokens": 4096
  }
}
```

### 2. Set Your API Key

**Option A: Using .env file (Recommended)**

Create a `.env` file in your project directory:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**Option B: Using environment variable**

Export the variable in your shell:

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

## Available Models

- `claude-sonnet-5-5` (default) - Best balance of intelligence, speed, and cost
- `claude-opus-5-5` - Most capable Opus-tier model, best for complex tasks
- `claude-fable-5-1` - Highest capability tier (premium pricing)
- `claude-haiku-4-5-20251001` - Fastest and most cost-effective

## Usage

Once configured, use ship normally:

```bash
# Generate posts
ship work

# Override model
ship work --model claude-opus-5-5

# Check available strategies
ship work --list-strategies
```

## Configuration Options

In `.shiprc.json`:

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
  }
}
```

- `model`: Which Claude model to use
- `maxTokens`: Maximum tokens in response (default: 4096)
- `temperature`: Omitted for Sonnet 5.5, Opus 5.5, Fable 5.1, and unrecognized Claude models. Supported legacy models and Haiku 4.5 can still use this setting.

## Switching Back to Ollama

Edit `.shiprc.json` and change the provider back:

```json
{
  "llm": {
    "provider": "ollama"
  }
}
```

## Troubleshooting

### "API key not found" error

Make sure you've either:
- Created a `.env` file with `ANTHROPIC_API_KEY=...`
- Exported `ANTHROPIC_API_KEY` in your shell

### "API is not available" error

Check:
- Your API key is valid
- You have internet connectivity
- Your Anthropic account has credits

### Cost considerations

Anthropic charges per token. Monitor your usage at https://console.anthropic.com/

Approximate costs (as of 2024):
- Claude 3.5 Sonnet: $3/$15 per million tokens (input/output)
- Claude 3 Opus: $15/$75 per million tokens
- Claude 3 Haiku: $0.25/$1.25 per million tokens

Use **ship ui → Settings** to choose a model and enter credentials without editing configuration files. The model field suggests the current lineup while allowing custom IDs. Temperature disappears when it is not supported; stored legacy values do not get sent to those models. Explicitly configured older model IDs are preserved.

Model IDs and sampling guidance checked October 5, 2026 against the [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview) and [Opus migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).
