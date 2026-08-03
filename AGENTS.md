# AI Agent Guidelines

## Issue Tracking

Use **GitHub issues** (`gh issue list/create/close`) for all tracking.
Do not use markdown TODOs, task lists, or local trackers.

## Managing AI-Generated Planning Documents

AI assistants often create planning and design documents during development:
- PLAN.md, IMPLEMENTATION.md, ARCHITECTURE.md
- DESIGN.md, CODEBASE_SUMMARY.md, INTEGRATION_PLAN.md
- TESTING_GUIDE.md, TECHNICAL_DESIGN.md, and similar files

**Best Practice: Use a dedicated directory for these ephemeral files**

**Recommended approach:**
- Create a `history/` directory in the project root
- Store ALL AI-generated planning/design docs in `history/`
- Keep the repository root clean and focused on permanent project files
- Only access `history/` when explicitly asked to review past planning

**Example .gitignore entry (optional):**
```
# AI planning documents (ephemeral)
history/
```

**Benefits:**
- ✅ Clean repository root
- ✅ Clear separation between ephemeral and permanent documentation
- ✅ Easy to exclude from version control if desired
- ✅ Preserves planning history for archeological research
- ✅ Reduces noise when browsing the project

### Prompt Management

**CRITICAL**: All prompts must be user-editable and stored in the `prompts/` directory.

**Rule**: Never hardcode prompts in source code. Always load prompts from files in the `prompts/` directory so users can customize them without editing code.

**Prompt files:**
- `prompts/style.md` - User's posting style and voice
- `prompts/work.md` - Post generation instructions
- `prompts/system.md` - System prompt for post generation
- `prompts/analysis.md` - Style analysis prompt for X posts

**Why this matters:**
- ✅ Users can customize prompts without touching code
- ✅ Prompts are version controlled with the project
- ✅ Easy to experiment with different prompting strategies
- ✅ Clear separation between code and configuration

**When adding new features:**
- If a feature uses an LLM prompt, create a new file in `prompts/`
- Load the prompt from the file, never hardcode it
- Update `ship init` to create the new prompt file
- Update FileSystemService's `loadPrompt()` type signature

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `gh issue list` before asking "what should I work on?"
- ✅ Store AI planning docs in `history/` directory
- ✅ **All prompts must be user-editable in `prompts/` directory**
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT clutter repo root with planning documents
- ❌ **Do NOT hardcode prompts in source code**

For more details, see README.md and QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
