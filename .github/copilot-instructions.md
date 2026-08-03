# GitHub Copilot Instructions

## Issue Tracking

This project tracks all work as **GitHub issues** (`gh issue list/create/close`).
Do NOT create markdown TODO lists or use other trackers.

### Workflow

1. **Check open work**: `gh issue list`
2. **Work on it**: Implement, test, document
3. **Discover new work?** `gh issue create` referencing the parent issue
4. **Complete**: close the issue from the PR (`Fixes #<id>`) or `gh issue close`

## Prompts

- If a feature uses an LLM prompt, create a new file in `prompts/`
- Load the prompt from the file, never hardcode it
- Update `ship init` to create the new prompt file
- Update FileSystemService's `loadPrompt()` type signature

## Important Rules

- ✅ Use GitHub issues for ALL task tracking
- ✅ Store AI planning docs in `history/` directory
- ✅ **All prompts must be user-editable in `prompts/` directory**
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT clutter repo root with planning documents
- ❌ **Do NOT hardcode prompts in source code**

For more details, see README.md and QUICKSTART.md.
