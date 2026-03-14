import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmdirSync, statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { Post } from '../types/post.js';
import type { T2pConfig } from '../types/config.js';
import type { T2pState, ProcessedFileInfo } from '../types/state.js';
import type { ContentStrategy } from '../types/strategy.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { FileSystemError, ConfigError, NotInitializedError } from '../utils/errors.js';
import { validateConfig } from '../utils/validation.js';
import { getErrorMessage } from '../utils/error-utils.js';

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

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
      // Busy wait
      const until = Date.now() + LOCK_RETRY_MS;
      while (Date.now() < until) { /* spin */ }
    }
  }
}

function releaseLock(lockPath: string): void {
  try { rmdirSync(lockPath); } catch {}
}

export class FileSystemService {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  loadConfig(): T2pConfig {
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

      return { ...DEFAULT_CONFIG, ...migratedConfig };
    } catch (error) {
      if (error instanceof NotInitializedError || error instanceof ConfigError) {
        throw error;
      }
      throw new FileSystemError(`Failed to load config: ${getErrorMessage(error)}`);
    }
  }

  saveConfig(config: T2pConfig): void {
    const configPath = join(this.cwd, '.shippostrc.json');

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to save config: ${getErrorMessage(error)}`);
    }
  }

  loadPrompt(filename: 'style.md' | 'work.md' | 'system.md' | 'analysis.md' | 'banger-eval.md' | 'content-analysis.md' | 'reply.md'): string {
    const promptPath = join(this.cwd, 'prompts', filename);

    if (!existsSync(promptPath)) {
      throw new NotInitializedError();
    }

    try {
      return readFileSync(promptPath, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to load prompt ${filename}: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to load strategies: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to append post: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to read posts: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to write posts: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to update post: ${getErrorMessage(error)}`);
    } finally {
      releaseLock(lockPath);
    }
  }

  createPost(sourceFile: string, content: string, model: string, temperature: number): Post {
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
        throw new FileSystemError(`Failed to create directory ${path}: ${getErrorMessage(error)}`);
      }
    }
  }

  writeFile(path: string, content: string): void {
    try {
      writeFileSync(path, content, 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to write file ${path}: ${getErrorMessage(error)}`);
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
      throw new FileSystemError(`Failed to load state: ${getErrorMessage(error)}`);
    }
  }

  saveState(state: T2pState): void {
    const statePath = join(this.cwd, '.shippost-state.json');

    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      throw new FileSystemError(`Failed to save state: ${getErrorMessage(error)}`);
    }
  }

  isFileProcessed(filePath: string, state: T2pState): boolean {
    return !!state.processedFiles[filePath];
  }

  markFileProcessed(filePath: string, postsGenerated: number, state: T2pState): T2pState {
    try {
      const stats = statSync(filePath);
      const modifiedAt = stats.mtime.toISOString();

      return {
        ...state,
        processedFiles: {
          ...state.processedFiles,
          [filePath]: {
            path: filePath,
            processedAt: new Date().toISOString(),
            modifiedAt,
            postsGenerated,
          },
        },
      };
    } catch (error) {
      throw new FileSystemError(`Failed to mark file as processed: ${getErrorMessage(error)}`);
    }
  }
}
