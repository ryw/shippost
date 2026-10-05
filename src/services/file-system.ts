import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmdirSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Post } from '../types/post.js';
import type { T2pConfig } from '../types/config.js';
import type { T2pState, GenerationTarget } from '../types/state.js';
import { GENERATION_TARGETS } from '../types/state.js';
import type { ContentStrategy } from '../types/strategy.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { FileSystemError, ConfigError, NotInitializedError } from '../utils/errors.js';
import { loadWorkspaceSecrets } from './workspace-secrets.js';
import { validateConfig } from '../utils/validation.js';

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const sleepBuffer = new SharedArrayBuffer(4);
const sleepArray = new Int32Array(sleepBuffer);

function sleepSync(ms: number): void {
  Atomics.wait(sleepArray, 0, 0, ms);
}

function acquireLock(lockPath: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath);
      return;
    } catch {
      if (Date.now() >= deadline) {
        // Stale lock — force remove and retry once
        try { rmdirSync(lockPath); } catch {}
        try { mkdirSync(lockPath); return; } catch {}
        throw new FileSystemError('Failed to acquire posts lock — another process may be writing');
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lockPath: string): void {
  try { rmdirSync(lockPath); } catch {}
}

function applyEnvOverrides(config: T2pConfig): T2pConfig {
  const next: T2pConfig = {
    ...config,
    llm: { ...config.llm },
    ollama: config.ollama ? { ...config.ollama } : undefined,
    anthropic: config.anthropic ? { ...config.anthropic } : undefined,
    generation: {
      ...config.generation,
      strategies: config.generation.strategies ? { ...config.generation.strategies } : undefined,
    },
    x: config.x ? { ...config.x } : undefined,
    typefully: config.typefully ? { ...config.typefully } : undefined,
    blog: config.blog ? { ...config.blog } : undefined,
  };

  if (process.env.SHIPPOST_X_CLIENT_ID) {
    next.x = { ...next.x, clientId: process.env.SHIPPOST_X_CLIENT_ID };
  }
  if (process.env.SHIPPOST_X_API_TIER === 'free' || process.env.SHIPPOST_X_API_TIER === 'basic') {
    next.x = { ...next.x, apiTier: process.env.SHIPPOST_X_API_TIER };
  }
  if (process.env.TYPEFULLY_SOCIAL_SET_ID) {
    next.typefully = { ...next.typefully, socialSetId: process.env.TYPEFULLY_SOCIAL_SET_ID };
  }

  return next;
}

export class FileSystemService {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  loadConfig(): T2pConfig {
    loadWorkspaceSecrets(this.cwd);
    const configPath = join(this.cwd, '.shippostrc.json');

    if (!existsSync(configPath)) {
      throw new NotInitializedError();
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      if (!validateConfig(config)) {
        throw new ConfigError('Invalid configuration format');
      }

      // Migrate old config format to new format
      let migratedConfig = { ...config };
      if (!config.llm && config.ollama) {
        // Old format detected - migrate to new format
        migratedConfig = {
          llm: {
            provider: 'ollama',
          },
          ...config,
        };
      }

      const mergedConfig: T2pConfig = {
        ...DEFAULT_CONFIG,
        ...migratedConfig,
        llm: { ...DEFAULT_CONFIG.llm, ...migratedConfig.llm },
        ollama: { ...DEFAULT_CONFIG.ollama, ...migratedConfig.ollama },
        anthropic: { ...DEFAULT_CONFIG.anthropic, ...migratedConfig.anthropic },
        generation: {
          ...DEFAULT_CONFIG.generation,
          ...migratedConfig.generation,
          strategies: {
            ...DEFAULT_CONFIG.generation.strategies,
            ...migratedConfig.generation?.strategies,
          },
        },
        x: migratedConfig.x ? { ...migratedConfig.x } : undefined,
        typefully: migratedConfig.typefully ? { ...migratedConfig.typefully } : undefined,
        blog: migratedConfig.blog ? { ...migratedConfig.blog } : undefined,
      };

      return applyEnvOverrides(mergedConfig);
    } catch (error) {
      if (error instanceof NotInitializedError || error instanceof ConfigError) {
        throw error;
      }
      throw new FileSystemError(`Failed to load config: ${(error as Error).message}`);
    }
  }

  saveConfig(config: T2pConfig): void {
    const configPath = join(this.cwd, '.shippostrc.json');

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to save config: ${(error as Error).message}`);
    }
  }

  loadPrompt(filename: 'style.md' | 'work.md' | 'system.md' | 'analysis.md' | 'banger-eval.md' | 'content-analysis.md' | 'reply.md' | 'blog-revision.md'): string {
    const promptPath = join(this.cwd, 'prompts', filename);

    if (!existsSync(promptPath)) {
      throw new NotInitializedError();
    }

    try {
      return readFileSync(promptPath, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to load prompt ${filename}: ${(error as Error).message}`);
    }
  }

  loadStrategies(): ContentStrategy[] {
    const strategiesPath = join(this.cwd, 'strategies.json');

    if (!existsSync(strategiesPath)) {
      // Return empty array if strategies file doesn't exist (backward compat)
      return [];
    }

    try {
      const content = readFileSync(strategiesPath, 'utf-8');
      const strategies: ContentStrategy[] = JSON.parse(content);

      if (!Array.isArray(strategies)) {
        throw new Error('Strategies file must contain a JSON array');
      }

      return strategies;
    } catch (error) {
      throw new FileSystemError(`Failed to load strategies: ${(error as Error).message}`);
    }
  }

  private get postsLockPath(): string {
    return join(this.cwd, '.posts.lock');
  }

  appendPost(post: Post): void {
    const postsPath = join(this.cwd, 'posts.jsonl');
    const lockPath = this.postsLockPath;

    acquireLock(lockPath);
    try {
      const line = JSON.stringify(post) + '\n';
      appendFileSync(postsPath, line, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to append post: ${(error as Error).message}`);
    } finally {
      releaseLock(lockPath);
    }
  }

  readPosts(): Post[] {
    const postsPath = join(this.cwd, 'posts.jsonl');
    const lockPath = this.postsLockPath;

    if (!existsSync(postsPath)) {
      return [];
    }

    acquireLock(lockPath);
    try {
      const content = readFileSync(postsPath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);

      return lines.map((line) => JSON.parse(line) as Post);
    } catch (error) {
      throw new FileSystemError(`Failed to read posts: ${(error as Error).message}`);
    } finally {
      releaseLock(lockPath);
    }
  }

  writePosts(posts: Post[]): void {
    const postsPath = join(this.cwd, 'posts.jsonl');
    const lockPath = this.postsLockPath;

    acquireLock(lockPath);
    try {
      const content = posts.map((post) => JSON.stringify(post)).join('\n') + '\n';
      writeFileSync(postsPath, content, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to write posts: ${(error as Error).message}`);
    } finally {
      releaseLock(lockPath);
    }
  }

  /** Atomically update a single post by ID (re-reads file inside lock). */
  updatePost(postId: string, updater: (post: Post) => Post): void {
    const postsPath = join(this.cwd, 'posts.jsonl');
    const lockPath = this.postsLockPath;

    acquireLock(lockPath);
    try {
      const content = readFileSync(postsPath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);
      const posts = lines.map((line) => JSON.parse(line) as Post);

      const index = posts.findIndex((p) => p.id === postId);
      if (index !== -1) {
        posts[index] = updater(posts[index]);
      }

      const output = posts.map((post) => JSON.stringify(post)).join('\n') + '\n';
      writeFileSync(postsPath, output, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to update post: ${(error as Error).message}`);
    } finally {
      releaseLock(lockPath);
    }
  }

  createPost(sourceFile: string, content: string, model: string, temperature: number | undefined): Post {
    return {
      id: randomUUID(),
      sourceFile,
      content,
      metadata: {
        model,
        temperature,
      },
      timestamp: new Date().toISOString(),
      status: 'new',
    };
  }

  ensureDirectory(path: string): void {
    if (!existsSync(path)) {
      try {
        mkdirSync(path, { recursive: true });
      } catch (error) {
        throw new FileSystemError(`Failed to create directory ${path}: ${(error as Error).message}`);
      }
    }
  }

  writeFile(path: string, content: string): void {
    try {
      writeFileSync(path, content, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to write file ${path}: ${(error as Error).message}`);
    }
  }

  fileExists(path: string): boolean {
    return existsSync(path);
  }

  loadState(): T2pState {
    const statePath = join(this.cwd, '.shippost-state.json');

    if (!existsSync(statePath)) {
      return { processedFiles: {} };
    }

    try {
      const content = readFileSync(statePath, 'utf-8');
      return JSON.parse(content) as T2pState;
    } catch (error) {
      throw new FileSystemError(`Failed to load state: ${(error as Error).message}`);
    }
  }

  saveState(state: T2pState): void {
    const statePath = join(this.cwd, '.shippost-state.json');

    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to save state: ${(error as Error).message}`);
    }
  }

  isFileProcessed(filePath: string, state: T2pState, target: GenerationTarget = 'social'): boolean {
    const entry = state.processedFiles[filePath];
    // Old runs bundled all outputs. Preserve them rather than silently regenerate.
    return !!entry && (!entry.targets || !!entry.targets[target]);
  }

  markFileProcessed(filePath: string, postsGenerated: number, state: T2pState, target: GenerationTarget = 'social'): T2pState {
    try {
      const stats = statSync(filePath);
      const modifiedAt = stats.mtime.toISOString();
      const previous = state.processedFiles[filePath];
      const targets = previous && !previous.targets
        ? Object.fromEntries(GENERATION_TARGETS.map((name) => [name, { processedAt: previous.processedAt, postsGenerated: previous.postsGenerated }]))
        : previous?.targets || {};
      const processedAt = new Date().toISOString();

      return {
        ...state,
        processedFiles: {
          ...state.processedFiles,
          [filePath]: {
            path: filePath,
            processedAt,
            targets: { ...targets, [target]: { processedAt, postsGenerated } },
            modifiedAt,
            postsGenerated,
          },
        },
      };
    } catch (error) {
      throw new FileSystemError(`Failed to mark file as processed: ${(error as Error).message}`);
    }
  }
}
