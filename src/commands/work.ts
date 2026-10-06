import { beginGenerationRun } from '../services/generation-metrics.js';
import { revisionCatalog, discoverRevisionCandidates } from '../services/revision-candidates.js';
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'fs';
import { join, relative, basename } from 'path';
import { FileSystemService } from '../services/file-system.js';
import { createLLMService } from '../services/llm-factory.js';
import { planSocialPosts, textOnlyStrategies, renderPrompt, type SocialAssignment } from '../services/social-plan.js';
import { StrategySelector } from '../services/strategy-selector.js';
import { logger } from '../utils/logger.js';
import { readlineSync } from '../utils/readline.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';
import { buildBangerEvalPrompt, parseBangerEval } from '../utils/banger-eval.js';
import type { PostGenerationResult } from '../types/post.js';
import type { StrategyCategory } from '../types/strategy.js';
import { granolaSyncCommand } from './granola-sync.js';
import { writeCover } from '../utils/svg-cover.js';
import { generateConceptCoverSvg } from '../utils/concept-cover.js';
import { createHash, randomUUID } from 'crypto';
import { isGenerationTarget } from '../types/state.js';
import type { Post } from '../types/post.js';
import type { LLMService } from '../services/llm-service.js';
import { isRecord, parseJsonFromResponse } from '../utils/json-parser.js';

interface WorkOptions {
  target?: string;
  sync?: boolean;
  model?: string;
  verbose?: boolean;
  force?: boolean;
  count?: number;
  strategy?: string;
  strategies?: string | false;
  listStrategies?: boolean;
  category?: string;
  noStrategies?: boolean;
  all?: boolean;
  files?: string;
}

function buildPrompt(systemPrompt: string, styleGuide: string, workInstructions: string, transcript: string): string {
  return `${systemPrompt}

STYLE GUIDE:
${styleGuide}

INSTRUCTIONS:
${workInstructions}

TRANSCRIPT TO PROCESS:
${transcript}`;
}

function parsePostsFromResponse(response: string): PostGenerationResult[] {
  try {
    // Split response by "---" delimiter
    const posts = response
      .split(/\n---\n/)
      .map(post => post.trim())
      .filter(post => post.length > 0);

    if (posts.length === 0) {
      throw new Error('No posts found in response');
    }

    // Convert to PostGenerationResult format and filter placeholders
    const validPosts = posts
      .map(postText => {
        // Check for platform tag at start
        const platformMatch = postText.match(/^\[PLATFORM:\s*(x|linkedin)\]/i);

        let content: string;
        let platform: 'x' | 'linkedin' | undefined;

        if (platformMatch) {
          platform = platformMatch[1].toLowerCase() as 'x' | 'linkedin';
          // Strip the platform tag from the content
          content = postText.replace(/^\[PLATFORM:\s*(x|linkedin)\]\s*/i, '').trim();
        } else {
          content = postText;
          platform = undefined;
        }

        return { content: stripEmDashes(content), platform };
      })
      .filter((item) => {
        const content = item.content;

        // Reject posts with common placeholder patterns
        if (content.includes('[Your Name]')) return false;
        if (content.includes('[Topic]')) return false;
        if (content.includes('[Company]')) return false;
        if (content.includes('[Product]')) return false;
        if (/\[[\w\s]+\]/.test(content)) return false; // Any [Placeholder Text]

        return true;
      });

    if (validPosts.length === 0 && posts.length > 0) {
      throw new Error('All generated posts contained placeholder text - rejected');
    }

    return validPosts;
  } catch (error) {
    logger.error(`Failed to parse LLM response: ${(error as Error).message}`);
    logger.info('Raw response:');
    logger.info(response.substring(0, 500));
    return [];
  }
}

function findInputFiles(inputDir: string): string[] {
  try {
    const files = readdirSync(inputDir);
    const textFiles: string[] = [];
    const realInputDir = realpathSync(inputDir);

    for (const file of files) {
      const filePath = join(inputDir, file);
      let realPath: string;
      try {
        realPath = realpathSync(filePath);
      } catch {
        logger.warn(`Skipping ${file}: unable to resolve path`);
        continue;
      }

      const rel = relative(realInputDir, realPath);
      if (rel === '' || rel.startsWith('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
        logger.warn(`Skipping ${file}: path resolves outside input/`);
        continue;
      }

      const stats = statSync(realPath);

      if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
        textFiles.push(realPath);
      }
    }

    // Sort by filename descending (newest first, since files are named YYYY-MM-DD_...)
    return textFiles.sort((a, b) => b.localeCompare(a));
  } catch (error) {
    logger.error(`Failed to read input directory: ${(error as Error).message}`);
    return [];
  }
}

interface BlogGenerationResult {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  takeaways: string[];
  faq: Array<{ question: string; answer: string }>;
  sources: Array<{ id: string; title: string; url: string }>;
  body: string;
  motif: string;
  accent?: string;
  accent2?: string;
}

interface PublishedPostRef {
  slug: string;
  title: string;
}

function extractFrontmatterTitle(content: string): string | null {
  // Frontmatter is delimited by --- on its own lines.
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  // Title styles seen in the corpus:
  //   title: 'Single quoted: with colon ok'
  //   title: "Double quoted"
  //   title: Plain unquoted title
  const titleLine = fm.split('\n').find((l) => /^title\s*:/.test(l));
  if (!titleLine) return null;
  const raw = titleLine.replace(/^title\s*:\s*/, '').trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  return raw;
}

function loadPublishedPostIndex(postsDir: string): PublishedPostRef[] {
  if (!existsSync(postsDir)) return [];
  const refs: PublishedPostRef[] = [];
  try {
    for (const file of readdirSync(postsDir)) {
      if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
      const slug = file.replace(/\.(mdx|md)$/, '');
      try {
        const content = readFileSync(join(postsDir, file), 'utf-8');
        const title = extractFrontmatterTitle(content) || slug;
        refs.push({ slug, title });
      } catch {
        // skip unreadable file
      }
    }
  } catch {
    // skip unreadable directory
  }
  refs.sort((a, b) => a.slug.localeCompare(b.slug));
  return refs;
}

function bodyLinksToPublished(body: string, knownSlugs: Set<string>): boolean {
  // Look for markdown links of the form [anchor](/some-slug). Posts route at root.
  const linkPattern = /\]\(\/([a-z0-9][a-z0-9-]*)(?:[)#?])/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(body)) !== null) {
    if (knownSlugs.has(match[1])) return true;
  }
  return false;
}

// Site rule: generated essays must contain zero em dashes (rywalker.com lint
// allows at most one per essay, and that one is reserved for human edits).
// The prompt forbids them; this is the mechanical backstop for any that slip
// through.
function stripEmDashes(s: string): string {
  return s.replace(/[ \t]*—[ \t]*/g, ', ');
}

function normalizeBlogResult(e: any): BlogGenerationResult {
  return {
    title: stripEmDashes(e.title || 'Untitled Blog Draft'),
    slug: e.slug || createSlug(e.title || 'untitled'),
    description: stripEmDashes(e.description || ''),
    tags: Array.isArray(e.tags) ? e.tags : ['ai'],
    takeaways: Array.isArray(e.takeaways)
      ? e.takeaways.map((t: any) => (typeof t === 'string' ? stripEmDashes(t) : t))
      : [],
    faq: Array.isArray(e.faq)
      ? e.faq.map((f: any) =>
          f && typeof f === 'object'
            ? {
                ...f,
                question: typeof f.question === 'string' ? stripEmDashes(f.question) : f.question,
                answer: typeof f.answer === 'string' ? stripEmDashes(f.answer) : f.answer,
              }
            : f
        )
      : [],
    sources: Array.isArray(e.sources) ? e.sources : [],
    body: stripEmDashes((e.body || '').replace(/\\n/g, '\n')),
    motif: typeof e.motif === 'string' ? e.motif : '',
    accent: typeof e.accent === 'string' ? e.accent : undefined,
    accent2: typeof e.accent2 === 'string' ? e.accent2 : undefined,
  };
}

function isBlogJsonResponse(value: unknown): value is { essays?: unknown[]; title?: unknown; body?: unknown } | unknown[] {
  if (Array.isArray(value)) return value.every(isBlogResultCandidate);
  if (!isRecord(value)) return false;
  if (Array.isArray(value.essays)) return value.essays.every(isBlogResultCandidate);
  return isBlogResultCandidate(value);
}

function isBlogResultCandidate(value: unknown): boolean {
  return isRecord(value) && (
    typeof value.title === 'string' ||
    typeof value.body === 'string' ||
    typeof value.slug === 'string'
  );
}

async function generateBlogDrafts(
  llm: LLMService,
  transcript: string,
  styleGuide: string,
  publishedPosts: PublishedPostRef[],
  template: string
): Promise<BlogGenerationResult[]> {
  const prompt = renderPrompt(template, { style: styleGuide, transcript, publishedPosts: publishedPosts.map(p => JSON.stringify({ title: p.title, slug: p.slug })).join('\n') });

  const response = await llm.generate(prompt, 'blog-draft');

  try {
    const parsed = parseJsonFromResponse(response, isBlogJsonResponse, 'any');
    if (!parsed) {
      throw new Error('No valid JSON blog response');
    }

    let essays: any[];
    if (Array.isArray(parsed)) {
      essays = parsed;
    } else if (Array.isArray(parsed.essays)) {
      essays = parsed.essays;
    } else if (parsed.title || parsed.body) {
      // Single-essay fallback shape (older prompt response)
      essays = [parsed];
    } else {
      essays = [];
    }

    if (essays.length === 0) {
      throw new Error('No essays in response');
    }

    return essays.slice(0, 3).map(normalizeBlogResult);
  } catch {
    // Fallback: try to extract title and body from markdown response
    const lines = response.trim().split('\n');
    const titleIndex = lines.findIndex((l: string) => l.startsWith('# '));
    const title = titleIndex >= 0 ? lines[titleIndex].substring(2).trim() : 'Untitled Blog Draft';
    const bodyStart = titleIndex >= 0 ? titleIndex + 1 : 0;
    const body = lines.slice(bodyStart).join('\n').trim();

    return [{
      title,
      slug: createSlug(title),
      description: '',
      tags: ['ai'],
      takeaways: [],
      faq: [],
      sources: [],
      body,
      motif: '',
    }];
  }
}

function quoteYamlString(s: string): string {
  // YAML plain-scalar list items break when they contain a colon followed by
  // whitespace (parser turns the line into a mapping, not a string). Quote
  // anything that could trigger that — and escape embedded single quotes.
  const needsQuoting = /:\s|^\s|\s$|^[!&*\-?|>%@`]|^[\[\]{}]/.test(s);
  if (!needsQuoting) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim hyphens from start/end
}

async function saveBlogDraft(
  outputDir: string,
  result: BlogGenerationResult,
  sourceFile: string,
  imageDir: string,
  imagePathPrefix: string,
  llm: LLMService
): Promise<string> {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const slug = result.slug || createSlug(result.title);
  const filename = `${slug}.mdx`;
  const filePath = join(outputDir, filename);

  // Generate the SVG cover. Try the concept-tied LLM generator first so the
  // image hints at the post's metaphor. Fall back to the deterministic
  // geometric motif if the LLM call fails or returns malformed SVG.
  const imageFilePath = join(imageDir, `${slug}.svg`);
  if (!existsSync(imageDir)) {
    mkdirSync(imageDir, { recursive: true });
  }
  let coverWritten = false;
  try {
    const conceptSvg = await generateConceptCoverSvg(llm, {
      slug,
      title: result.title,
      description: result.description,
      body: result.body,
    });
    writeFileSync(imageFilePath, conceptSvg, 'utf-8');
    coverWritten = true;
  } catch {
    // fall through to geometric
  }
  if (!coverWritten) {
    writeCover(imageFilePath, {
      slug,
      motif: result.motif,
      accent: result.accent,
      accent2: result.accent2,
    });
  }
  const imageWebPath = `${imagePathPrefix.replace(/\/$/, '')}/${slug}.svg`;

  // Build frontmatter matching published post format
  const tagsYaml = result.tags.map((t: string) => `  - ${quoteYamlString(t)}`).join('\n');
  const takeawaysYaml = result.takeaways.map((t: string) => `  - ${quoteYamlString(t)}`).join('\n');

  let faqYaml = '';
  if (result.faq.length > 0) {
    faqYaml = 'faq:\n' + result.faq.map((f: { question: string; answer: string }) =>
      `  - question: "${f.question.replace(/"/g, '\\"')}"\n    answer: >-\n      ${f.answer}`
    ).join('\n');
  }

  let sourcesYaml = '';
  if (result.sources.length > 0) {
    sourcesYaml = 'sources:\n' + result.sources.map((s: { id: string; title: string; url: string }) =>
      `  - id: ${s.id}\n    title: "${s.title.replace(/"/g, '\\"')}"\n    url: ${s.url}`
    ).join('\n');
  }

  const frontmatter = `---
title: "${result.title.replace(/"/g, '\\"')}"
date: '${today}'
description: >-
  ${result.description}
image: ${imageWebPath}
tags:
${tagsYaml}
source: ${sourceFile}
draft: true
takeaways:
${takeawaysYaml}
${faqYaml}
${sourcesYaml}
---

${result.body}`;

  writeFileSync(filePath, frontmatter, 'utf-8');
  return filePath;
}

async function proposeRelatedBlogRevisions(
  llm: LLMService, transcript: string, contentDirs: string[], revisionTemplate: string, sourceFile: string
): Promise<Array<{ path: string; updated: boolean }>> {
  const dir = join(process.cwd(), '.shippost-revisions');
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, createHash('sha256').update(sourceFile).digest('hex') + '.run.json');
  const record = (status: string) => {
    const temporary = marker + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify({ sourceFile, status, updatedAt: new Date().toISOString() }));
    renameSync(temporary, marker);
  };
  record('running');
  try {
    const results = await runRelatedBlogRevisions(llm, transcript, contentDirs, revisionTemplate, sourceFile);
    record('completed');
    return results;
  } catch (error) { record('failed'); throw error; }
}

async function runRelatedBlogRevisions(
  llm: LLMService,
  transcript: string,
  contentDirs: string[],
  revisionTemplate: string,
  sourceFile: string
): Promise<Array<{ path: string; updated: boolean }>> {
  const fs = new FileSystemService(process.cwd());
  const catalog = revisionCatalog(contentDirs[1], contentDirs[0], sourceFile);
  logger.info(`  Scanning ${catalog.length} published essays for relevant arguments`);
  logger.info(`  Substep 0/1 · Finding related essays`);
  const candidates = await discoverRevisionCandidates(llm, catalog, transcript, fs.loadPrompt('revision-discovery.md'));
  logger.info(`  Reviewing ${candidates.length} candidates from ${catalog.length} published essays`);
  if (!candidates.length) return [];
  logger.info(`  Substep 0/${candidates.length} · Selecting related articles`);
  const planTemplate = new FileSystemService(process.cwd()).loadPrompt('revision-plan.md');
  const response = await llm.generate(renderPrompt(planTemplate, {
    transcript, articles: JSON.stringify(candidates.map((file, index) => ({ id: String(index), content: readFileSync(file.path, 'utf8') }))),
  }), 'revision-plan');
  const plan = parseJsonFromResponse(response, isRecord, 'object');
  if (!plan || !Array.isArray(plan.articles)) throw new Error('Invalid revision selection. Retry this target.');
  const selected = new Set<number>();
  for (const item of plan.articles) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^(0|[1-9]\d*)$/.test(item.id) ||
      Number(item.id) >= candidates.length || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('Invalid revision candidate. Retry this target.');
    selected.add(Number(item.id));
  }
  const files = [...selected].map(index => candidates[index]);
  const results: Array<{ path: string; updated: boolean }> = [];

  for (const [index, file] of files.entries()) {
    logger.info(`  Substep ${index + 1}/${files.length} · Checking articles`);
    try {
      const content = readFileSync(file.path, 'utf-8');

      const prompt = revisionTemplate.replace(/\{\{(transcript|content)\}\}/g, (_, key) => key === 'transcript' ? transcript : content);

      const response = await llm.generate(prompt, 'article-revision');

      const trimmed = response.trim();
      if (trimmed === 'SKIP') {
        results.push({ path: file.path, updated: false });
      } else {
        // Extract the actual file content — find the first --- frontmatter delimiter
        const fmStart = trimmed.indexOf('---');
        if (fmStart >= 0) {
          const proposalDir = join(process.cwd(), '.shippost-revisions');
          mkdirSync(proposalDir, { recursive: true });
          const proposal = join(proposalDir, randomUUID());
          writeFileSync(proposal + '.mdx', trimmed.slice(fmStart), 'utf-8');
          writeFileSync(proposal + '.json', JSON.stringify({
            originalPath: relative(process.cwd(), file.path), sourceFile,
            originalHash: createHash('sha256').update(content).digest('hex'),
            createdAt: new Date().toISOString(),
          }, null, 2));
          results.push({ path: file.path, updated: true });
        } else {
          throw new Error('Revision response has no frontmatter');
        }
      }
    } catch (error) {
      throw new Error(`Revision failed for ${basename(file.path)}: ${(error as Error).message}`);
    }
  }

  return results;
}

function listStrategiesCommand(fs: FileSystemService, options: WorkOptions): void {
  const userStrategies = fs.loadStrategies();

  if (userStrategies.length === 0) {
    logger.error('No strategies found. Create strategies.json in your project directory.');
    logger.info('Run: ship init  # to create default strategies file');
    process.exit(1);
  }

  const selector = new StrategySelector(userStrategies);
  const strategies = options.category
    ? selector.getStrategiesByCategory(options.category as StrategyCategory)
    : selector.getAllStrategies();

  if (strategies.length === 0) {
    logger.error(`No strategies found${options.category ? ` for category: ${options.category}` : ''}`);
    process.exit(1);
  }

  logger.blank();
  logger.success(`Available Content Strategies (${strategies.length})`);
  logger.blank();

  // Group by category
  const byCategory = new Map<StrategyCategory, typeof strategies>();
  for (const strategy of strategies) {
    if (!byCategory.has(strategy.category)) {
      byCategory.set(strategy.category, []);
    }
    byCategory.get(strategy.category)!.push(strategy);
  }

  // Display by category
  for (const [category, categoryStrategies] of byCategory) {
    logger.info(`\n${category.toUpperCase()}:`);
    for (const strategy of categoryStrategies) {
      const threadMarker = strategy.threadFriendly ? ' 🧵' : '';
      logger.info(`  ${strategy.id}${threadMarker}`);
      logger.info(`    ${strategy.name}`);
    }
  }

  logger.blank();
  logger.info('Usage:');
  logger.info('  ship work --strategy <id>           # Use specific strategy');
  logger.info('  ship work --strategies <id1,id2>    # Use multiple strategies');
  logger.info('  ship work                            # Auto-select strategies');
  logger.blank();
}

export async function workCommand(options: WorkOptions): Promise<void> {
  const cwd = process.cwd();
  const fs = new FileSystemService(cwd);

  // Handle --list-strategies early exit
  if (options.listStrategies) {
    listStrategiesCommand(fs, options);
    return;
  }

  try {
    const target = options.target || 'social';
    if (!isGenerationTarget(target)) throw new Error('target must be social, blog, or revisions');

    // Step 0: Sync Granola transcripts
    if (options.sync) {
      logger.section('[0/3] Syncing Granola transcripts...');
      try {
        await granolaSyncCommand({});
      } catch {
        logger.info('Granola sync skipped (not configured or no new transcripts)');
      }

    }

    // Step 1: Validate environment
    logger.section('[1/3] Checking environment...');

    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }

  // Load config
  const config = fs.loadConfig();

  // Override model if specified
  if (options.model) {
    if (config.llm.provider === 'ollama' && config.ollama) {
      config.ollama.model = options.model;
    } else if (config.llm.provider === 'grok') {
      config.grok = { model: options.model };
    } else if (config.llm.provider === 'anthropic' && config.anthropic) {
      config.anthropic.model = options.model;
    }
  }

  // Initialize LLM service
  const llm = createLLMService(config);

  // Check LLM availability
  await llm.ensureAvailable();
  logger.success(`Connected to ${config.llm.provider} (model: ${llm.getModelName()})`);

  // Step 2: Load context
  logger.section('[2/3] Loading context...');

  const systemPrompt = target === 'social' ? fs.loadPrompt('system.md') : '';
  logger.success('Loaded system prompt');

  const styleGuide = fs.loadPrompt('style.md');
  logger.success('Loaded style guide');

  const workInstructions = target === 'social' ? fs.loadPrompt('work.md') : '';
  logger.success('Loaded work instructions');

  const bangerEvalTemplate = target === 'social' ? fs.loadPrompt('banger-eval.md') : '';
  logger.success('Loaded banger evaluation prompt');

  // Load user-defined strategies
  const userStrategies = target === 'social' ? fs.loadStrategies() : [];
  logger.success(`Loaded ${userStrategies.length} content strategies`);

  // Initialize strategy services
  const strategySelector = new StrategySelector(
    userStrategies,
    config.generation.strategies?.diversityWeight ?? 0.7
  );

  // Determine strategy configuration
  const strategiesEnabled =
    !options.noStrategies && options.strategies !== false && (config.generation.strategies?.enabled === true);
  const postCount = options.count || config.generation.postsPerTranscript || 8;

  if (strategiesEnabled && options.verbose) {
    logger.info(`Strategy-based generation enabled (${postCount} posts per file)`);
  }

  let inputFiles = findInputFiles(join(cwd, 'input'));
  if (options.files) {
    const wanted = new Set(options.files.split(',').map((f) => f.trim()).filter(Boolean));
    inputFiles = inputFiles.filter((f) => wanted.has(basename(f)));
  }
  if (inputFiles.length === 0) {
    logger.error('No input files found in input/ directory');
    logger.info('Add .txt or .md files to input/ and try again');
    process.exit(1);
  }

  logger.success(`Found ${inputFiles.length} input file${inputFiles.length === 1 ? '' : 's'}`);

  // Load state
  let state = fs.loadState();
  if (options.force) {
    logger.info('Force mode: reprocessing all files');
  }

  // Count unprocessed files upfront
  const unprocessedFiles = options.force
    ? inputFiles
    : inputFiles.filter(f => !fs.isFileProcessed(f, state, target));
  let remaining = unprocessedFiles.length;

  if (remaining === 0) {
    logger.blank();
    logger.success('All transcripts already processed!');
    logger.info(`${inputFiles.length} files total, 0 remaining`);
    return;
  }

  logger.success(`${remaining} unprocessed transcript${remaining === 1 ? '' : 's'} to process`);

  // Step 3: Process files
  logger.section('[3/3] Processing files...');

  let totalProcessed = 0;
  let totalGenerated = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const filePath of inputFiles) {
    const relativePath = relative(cwd, filePath);
    logger.step(relativePath);

    // Check if file was already processed (unless --force is used)
    if (!options.force && fs.isFileProcessed(filePath, state, target)) {
      logger.info('  Skipped (already processed)');
      totalSkipped++;
      continue;
    }

    // Interactive per-transcript prompt
    if (!options.all) {
      const answer = await readlineSync(`  Process this transcript? (y/n/q) `);
      const choice = answer.trim().toLowerCase();
      if (choice === 'q') {
        logger.info('  Stopping.');
        break;
      }
      if (choice !== 'y' && choice !== 'yes') {
        logger.info('  Skipped');
        state = fs.markFileProcessed(filePath, 0, state, target);
        fs.saveState(state);
        totalSkipped++;
        remaining--;
        continue;
      }
    }

    const finishMetrics = beginGenerationRun(cwd, relativePath, target);
    let metricsOutcome = "failed";
    try {
      // Read transcript
      const transcript = readFileSync(filePath, 'utf-8');

      if (transcript.trim().length === 0) {
        metricsOutcome = 'empty';
        logger.info('  Skipped (empty file)');
        continue;
      }

      let postsGenerated = 0;
      let xPostsGenerated = 0;
      let linkedinPostsGenerated = 0;

      const pendingPosts: Post[] = [];
      let generationFailed = false;
      let blogDraftCount = 0;
      let updatedCount = 0;

      if (target === 'social') {
        // Strategy-based generation
        if (strategiesEnabled) {
          // Determine which strategies to use
          let selectedStrategies;
          let assignments: SocialAssignment[] = [];

          if (options.strategy) {
            // Manual single strategy selection
            selectedStrategies = strategySelector.getStrategiesByIds([options.strategy]);
            if (selectedStrategies.length === 0) {
              logger.info(`  No strategy found with ID: ${options.strategy}`);
              totalErrors++;
              continue;
            }
          } else if (options.strategies) {
            // Manual multiple strategy selection
            const ids = options.strategies.split(',').map((s) => s.trim());
            selectedStrategies = strategySelector.getStrategiesByIds(ids);
            if (selectedStrategies.length === 0) {
              logger.info(`  No strategies found for IDs: ${options.strategies}`);
              totalErrors++;
              continue;
            }
          } else {
            const candidates = textOnlyStrategies(userStrategies);
            if (!candidates.length) throw new Error('No text-only strategies available. Edit strategies.json to add supported strategies.');
            if (config.generation.strategies?.autoSelect !== false) {
              logger.info(`  Substep 0/${postCount} · Planning post angles`);
              assignments = await planSocialPosts(llm, fs.loadPrompt('social-plan.md'), styleGuide, transcript, candidates, postCount, config.generation.strategies);
              selectedStrategies = assignments.map(assignment => candidates.find(s => s.id === assignment.strategyId)!);
            } else {
              selectedStrategies = candidates.slice(0, postCount);
            }
          }

          if (options.verbose) {
            logger.info(`  Selected ${selectedStrategies.length} strategies`);
          }

          logger.info(`  Generating ${selectedStrategies.length} posts...`);

          // Generate one post per strategy
          for (let i = 0; i < selectedStrategies.length; i++) {
            const strategy = selectedStrategies[i];
            const progress = `[${i + 1}/${selectedStrategies.length}]`;

            try {
              // Show which strategy is being processed
              logger.info(`  ${progress} ${strategy.name}...`);
              logger.info(`  Substep ${i + 1}/${selectedStrategies.length} · Drafting social posts`);

              const assignment = assignments[i];
              const strategyPrompt = renderPrompt(fs.loadPrompt('social-strategy.md'), {
                style: styleGuide, transcript,
                plan: assignments.length ? JSON.stringify(assignments) : '[]',
                assignment: assignment ? JSON.stringify(assignment) : JSON.stringify({ strategyId: strategy.id }),
                strategy: strategy.prompt,
                previousPosts: assignments.length ? '[]' : JSON.stringify(pendingPosts.map(post => post.content)),
              });

              const response = await llm.generate(strategyPrompt, 'social-draft');
              if (response.trim() === 'SKIP') { logger.info(`  ${progress} Skipped unsupported angle`); continue; }

              // Parse single post from response
              const posts = parsePostsFromResponse(response);

              if (posts.length > 0) {
                const postData = posts[0]; // Take first post

                const post = fs.createPost(
                  relativePath,
                  postData.content,
                  llm.getModelName(),
                  llm.getTemperature()
                );

                // Set platform
                post.platform = postData.platform || assignment?.platform || 'x';

                // Add strategy metadata
                post.metadata.strategy = {
                  id: strategy.id,
                  name: strategy.name,
                  category: strategy.category,
                };

                // Evaluate banger potential
                try {
                  logger.info(`  Substep ${i + 1}/${selectedStrategies.length} · Evaluating social posts`);
                  const evalPrompt = buildBangerEvalPrompt(bangerEvalTemplate, postData.content);
                  const evalResponse = await llm.generate(evalPrompt, 'social-evaluation');
                  const evaluation = parseBangerEval(evalResponse);

                  if (evaluation) {
                    post.metadata.bangerScore = evaluation.score;
                    post.metadata.bangerEvaluation = evaluation;

                    // Show banger score if available
                    if (options.verbose) {
                      logger.info(`    ✓ Generated (banger: ${evaluation.score}/99)`);
                    }
                  }
                } catch (evalError) {
                  if (options.verbose) {
                    logger.info(`    ✓ Generated (banger eval failed)`);
                  }
                }

                pendingPosts.push(post);
                postsGenerated++;

                // Count by platform
                if (post.platform === 'linkedin') {
                  linkedinPostsGenerated++;
                } else {
                  xPostsGenerated++;
                }

                // Show completion with post content
                if (!options.verbose) {
                  logger.success(`  ${progress} ✓ Complete`);
                }

                // Display the generated post
                logger.blank();
                const bangerInfo = post.metadata.bangerScore
                  ? ` [banger: ${post.metadata.bangerScore}/99]`
                  : '';
                logger.info(`  📝 Post ${i + 1}: ${strategy.name}${bangerInfo}`);
                logger.info('  ' + '─'.repeat(60));
                // Indent each line of the post content
                const lines = postData.content.split('\n');
                lines.forEach(line => {
                  logger.info(`  ${line}`);
                });
                logger.info('  ' + '─'.repeat(60));
                logger.blank();
              } else {
                generationFailed = true;
                logger.info(`  ${progress} ✗ No valid post generated`);
              }
            } catch (stratError) {
              generationFailed = true;
              logger.info(`  ${progress} ✗ Failed: ${(stratError as Error).message}`);
              if (options.verbose) {
                logger.info(`    Strategy: ${strategy.id}`);
              }
            }
          }
        } else {
          // Direct generation using work.md instructions
          logger.info(`  Generating posts...`);
          logger.info(`  Substep 1/1 · Drafting social posts`);

          const prompt = buildPrompt(systemPrompt, styleGuide, workInstructions, transcript);

          if (options.verbose) {
            logger.info(`  Prompt length: ${prompt.length} characters`);
          }

          const response = await llm.generate(prompt, 'social-draft');

          if (options.verbose) {
            logger.info(`  Response length: ${response.length} characters`);
          }

          const posts = parsePostsFromResponse(response);

          if (posts.length === 0) {
            logger.info('  ✗ Generated 0 posts (parsing failed)');
            totalErrors++;
            continue;
          }

          logger.info(`  Generated ${posts.length} posts, evaluating...`);

          // Evaluate and save posts
          for (let i = 0; i < posts.length; i++) {
            logger.info(`  Substep ${i + 1}/${posts.length} · Evaluating social posts`);
            const postData = posts[i];
            const progress = `[${i + 1}/${posts.length}]`;

            if (options.verbose) {
              logger.info(`  ${progress} Evaluating post...`);
            }
            const post = fs.createPost(
              relativePath,
              postData.content,
              llm.getModelName(),
              llm.getTemperature()
            );

            // Set platform
            post.platform = postData.platform || 'x';

            // Evaluate banger potential
            try {
              const evalPrompt = buildBangerEvalPrompt(bangerEvalTemplate, postData.content);
              const evalResponse = await llm.generate(evalPrompt, 'social-evaluation');
              const evaluation = parseBangerEval(evalResponse);

              if (evaluation) {
                post.metadata.bangerScore = evaluation.score;
                post.metadata.bangerEvaluation = evaluation;

                if (options.verbose) {
                  logger.info(`  ${progress} ✓ Saved (banger: ${evaluation.score}/99)`);
                }
              }
            } catch (evalError) {
              if (options.verbose) {
                logger.info(`  ${progress} ✓ Saved (banger eval failed)`);
              }
            }

            pendingPosts.push(post);
            postsGenerated++;

            // Count by platform
            if (post.platform === 'linkedin') {
              linkedinPostsGenerated++;
            } else {
              xPostsGenerated++;
            }

            // Display the generated post
            logger.blank();
            const bangerInfo = post.metadata.bangerScore
              ? ` [banger: ${post.metadata.bangerScore}/99]`
              : '';
            logger.info(`  📝 Post ${i + 1}${bangerInfo}`);
            logger.info('  ' + '─'.repeat(60));
            // Indent each line of the post content
            const lines = postData.content.split('\n');
            lines.forEach(line => {
              logger.info(`  ${line}`);
            });
            logger.info('  ' + '─'.repeat(60));
            logger.blank();
          }

          logger.success(`  ✓ Saved ${posts.length} posts`);
        }

        if (generationFailed || pendingPosts.length === 0) throw new Error('Social generation incomplete; no posts saved. Retry this target.');
        for (const post of pendingPosts) fs.appendPost(post);
      }

      // Platform counts are tracked during generation

      const draftsDir = config.blog?.outputDir || 'src/content/drafts';
      const postsDir = join(draftsDir, '..', 'posts');

      if (target === 'blog') {
        // Load published post index so the LLM can cross-link new essays
        const publishedIndex = loadPublishedPostIndex(postsDir);
        if (options.verbose) {
          logger.info(`  Loaded ${publishedIndex.length} published essays for cross-linking`);
        }
        const publishedSlugSet = new Set(publishedIndex.map((p) => p.slug));

        // Generate blog drafts (1-3 atomic essays per transcript)
        logger.info('  Generating blog drafts...');
        logger.info('  Substep 1/1 · Drafting essays');
        const blogResults = await generateBlogDrafts(llm, transcript, styleGuide, publishedIndex, fs.loadPrompt('blog-draft.md'));
        logger.info(`  LLM identified ${blogResults.length} atomic essay${blogResults.length === 1 ? '' : 's'}`);

        // Validate each essay cross-links to at least one published essay
        if (publishedIndex.length > 0) {
          for (let i = 0; i < blogResults.length; i++) {
            if (!bodyLinksToPublished(blogResults[i].body, publishedSlugSet)) {
              logger.info(`  ⚠ Essay ${i + 1} ("${blogResults[i].title}") has no link to a published essay`);
            }
          }
        }

        // Disambiguate within-run slug collisions so two essays from the same
        // transcript don't overwrite each other.
        const usedSlugs = new Set<string>();
        blogDraftCount = blogResults.length;
        for (const [index, result] of blogResults.entries()) {
          logger.info(`  Substep ${index + 1}/${blogResults.length} · Preparing drafts and covers`);
          const baseSlug = createSlug(result.slug || result.title) || 'draft';
          let slug = baseSlug;
          let n = 2;
          while (usedSlugs.has(slug) || existsSync(join(draftsDir, slug + '.mdx')) || existsSync(join(postsDir, slug + '.mdx')) || existsSync(join(config.blog?.imageDir || 'public/images/posts', slug + '.svg'))) {
            slug = `${baseSlug}-${n}`;
            n++;
          }
          usedSlugs.add(slug);
          result.slug = slug;

          const blogPath = await saveBlogDraft(
            draftsDir,
            result,
            relativePath,
            config.blog?.imageDir || 'public/images/posts',
            config.blog?.imagePathPrefix || '/images/posts',
            llm
          );
          logger.success(`  Blog draft: ${relative(cwd, blogPath)}`);
        }

      }
      if (target === 'revisions') {
        const revisionTemplate = fs.loadPrompt('blog-revision.md');
        logger.info('  Proposing revisions (original articles will remain unchanged)...');
        const updates = await proposeRelatedBlogRevisions(llm, transcript, [draftsDir, postsDir], revisionTemplate, relativePath);
        updatedCount = updates.filter(u => u.updated).length;
        logger.info(`  Saved ${updatedCount} proposals in .shippost-revisions/ for manual review`);
      }

      // Processing summary
      const summaryParts = [];
      if (xPostsGenerated > 0) summaryParts.push(`${xPostsGenerated} X post${xPostsGenerated === 1 ? '' : 's'}`);
      if (linkedinPostsGenerated > 0) summaryParts.push(`${linkedinPostsGenerated} LinkedIn post${linkedinPostsGenerated === 1 ? '' : 's'}`);
      if (target === 'blog') summaryParts.push(`${blogDraftCount} new blog draft${blogDraftCount === 1 ? '' : 's'}`);
      if (updatedCount > 0) summaryParts.push(`${updatedCount} article revision proposal${updatedCount === 1 ? '' : 's'}`);

      logger.info(`  Summary: ${summaryParts.join(', ')}`);
      totalProcessed++;
      totalGenerated += postsGenerated;
      remaining--;

      // Mark file as processed and save immediately
      state = fs.markFileProcessed(filePath, target === 'revisions' ? updatedCount : target === 'blog' ? blogDraftCount : postsGenerated, fs.loadState(), target);
      fs.saveState(state);

      metricsOutcome = 'completed';
      logger.success(`  ✓ Done — ${remaining} transcript${remaining === 1 ? '' : 's'} remaining`);
    } catch (error) {
      logger.error(`  Failed: ${(error as Error).message}`);
      totalErrors++;
    } finally { finishMetrics(metricsOutcome); }
  }

  // Summary
  logger.blank();
  logger.success('Complete!');
  logger.blank();
  logger.info('Summary:');
  logger.info(`- Files processed: ${totalProcessed}`);
  if (totalSkipped > 0) {
    logger.info(`- Files skipped: ${totalSkipped} (already processed)`);
  }
  logger.info(`- Posts generated: ${totalGenerated}`);
  if (totalErrors > 0) {
    logger.info(`- Errors: ${totalErrors}`);
  }
  logger.info(`- Target: ${target}`);
  if (target === 'social') logger.info('- Posts saved to: posts.jsonl');
  if (totalErrors > 0) process.exitCode = 1;

  if (totalGenerated > 0) {
    logger.blank();
    logger.info('Next steps:');
    logger.info('- Review posts in posts.jsonl');
    logger.info('- Run `ship review` to approve posts, then `ship ui` to stage them');
  }
  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
