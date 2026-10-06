# Workspace state in GitHub

A private backing repository is required before running the app's processing commands. The website repository itself can hold the state: for example, `ryw/rywalker.com`. Application code and published articles stay on their existing branches. Snapshots live on `tembo/shippost-state`; `tembo/shippost-writer` identifies the one workspace allowed to modify state.

## First connection

Authenticate `gh` with write access to the private repository. It must already have an initial commit (a README is enough). Start `ship ui`, open **Settings → Workspace backup**, enter `owner/name`, and choose **Connect / restore**. The current GitHub origin is suggested. Restart the app after connection so restored settings, queues, and services are loaded together.

CLI equivalent:

```sh
ship backup --repository ryw/rywalker.com
ship ui
```

For automated startup, set `SHIPPOST_STATE_REPOSITORY=ryw/rywalker.com`. CLI processing restores/validates the workspace before starting. A UI with missing or blocked backup setup still opens Settings, but cannot process work. Public and archived repositories are rejected, and the privacy check is repeated before writing snapshots.

No repository is created automatically and no files are committed to the website's main branch. A checkpoint is a JSON snapshot committed through GitHub's Git Data API. Ref updates are non-forced; conflicting updates fail instead of merging runtime state.

## What is preserved

- Meeting inputs; editable prompts and strategies.
- Social drafts and review state, including Typefully draft IDs.
- Generation completion records, queued and active targets, transcript decisions, Granola synchronization state, and website PR publication history.
- Unpublished essay drafts, SVG covers, and revision proposals/run markers.
- Non-secret settings and request/run diagnostics.

Credentials are excluded: `.env`, secret files, OAuth sessions, Grok subscription tokens, local owner records, process locks, arbitrary code, and unknown configuration fields are not included. Settings are copied through an explicit allowlist; inline Anthropic keys are removed. Reconnect credentials or provision environment secrets on the destination VM. Notes and drafts may themselves contain confidential information; the repository must remain private.

Only the standard `input`, `prompts`, `src/content/drafts`, `public/images/posts`, and `.shippost-revisions` layout is currently supported. Custom blog output locations fail validation rather than silently losing files. Snapshot size is capped at 40 MB; an oversized workspace needs log retention or a different storage backend. Git history retains old snapshots, including deleted notes, until repository history is deliberately purged.

## Checkpoints and failure behavior

Queue changes, saved completion state, post updates, settings, and PR-ledger changes checkpoint immediately. The UI also checkpoints at job completion and every 30 seconds to capture other changes. Identical content does not create another commit. Checkpoint failures are surfaced and local files remain available; only the last successfully acknowledged remote checkpoint is guaranteed on another VM.

Checkpoint requests use a local cross-process lock. If another local checkpoint is running, the operation waits up to ten seconds and then reports a retryable error instead of claiming the data was backed up. GitHub/network outages block new guarded work. Remote writes and privacy checks add latency; they are outside model calls in generation diagnostics.

Restoration validates paths and the complete snapshot digest before writing. It rejects symlinks and conflicting local files; unchanged files from a fresh code checkout may be replaced. A local restore journal permits completion after an interrupted restore. Completion paths are rebased to the new workspace and old worker PIDs are discarded. Do not copy local backup-owner files between VMs.

## Moving to another VM

1. In Settings, choose **Pause after this target**. Let the current target finish. Stop any standalone workers using this workspace.
2. Choose **Checkpoint & release VM**. This performs a final checkpoint and relinquishes the writer. Stop the old app.
3. Clone the application/site code on the new VM, authenticate GitHub, and connect the same state repository. Restore before making local edits.
4. Reconnect provider credentials, then restart the UI. The persisted queue resumes at target boundaries and skips completed targets.

The writer lock does not expire. A sleeping VM is still a possible writer. A second workspace cannot automatically take over. If the original VM is irretrievably gone, first ensure it cannot resume, then explicitly delete the repository branch `tembo/shippost-writer` through GitHub's branch UI and connect from the new workspace. Never delete `tembo/shippost-state` for this operation. Old guarded processes fail when they next check ownership.

## Recovery boundaries

This backs up application files; it does not serialize an in-flight model request or implement transactions across GitHub and Typefully. Unfinished generation targets may repeat work after a crash, including partially written draft/proposal output. Inspect partial outputs before forcing regeneration.

A Typefully request can succeed remotely before its returned draft ID reaches a checkpoint. After an interruption during staging, inspect Typefully before retrying; exactly-once delivery is not guaranteed. Existing checkpointed draft IDs and PR records are preserved, and the website publisher reconciles its stable PR branches. Backups do not justify running old app versions without writer checks alongside this version.
