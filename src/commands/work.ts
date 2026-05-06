import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { FileSystemService } from '../services/file-system.js';
import { createLLMService } from '../services/llm-factory.js';
import { ContentAnalyzer } from '../services/content-analyzer.js';
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

interface WorkOptions {
  model?: string;
  verbose?: boolean;
  force?: boolean;
  count?: number;
  strategy?: string;
  strategies?: string;
  listStrategies?: boolean;
  category?: string;
  noStrategies?: boolean;
  all?: boolean;
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

        return { content, platform };
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

    for (const file of files) {
      const filePath = join(inputDir, file);
      const stats = statSync(filePath);

      if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
        textFiles.push(filePath);
      }
    }

    // Sort by filename descending (newest first, since files are named YYYY-MM-DD_...)
    return textFiles.sort((a, b) => b.localeCompare(a));
  } catch (error) {
    logger.error(`Failed to read input directory: ${(error as Error).message}`);
    return [];
  }
}

function buildStrategyPrompt(
  systemPrompt: string,
  styleGuide: string,
  workInstructions: string,
  strategyPrompt: string,
  transcript: string
): string {
  return `${systemPrompt}

STYLE GUIDE:
${styleGuide}

INSTRUCTIONS:
${workInstructions}

CONTENT STRATEGY FOR THIS POST:
${strategyPrompt}

TRANSCRIPT TO PROCESS:
${transcript}

Generate a SINGLE post following the strategy above.`;
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

function normalizeBlogResult(e: any): BlogGenerationResult {
  return {
    title: e.title || 'Untitled Blog Draft',
    slug: e.slug || createSlug(e.title || 'untitled'),
    description: e.description || '',
    tags: Array.isArray(e.tags) ? e.tags : ['ai'],
    takeaways: Array.isArray(e.takeaways) ? e.takeaways : [],
    faq: Array.isArray(e.faq) ? e.faq : [],
    sources: Array.isArray(e.sources) ? e.sources : [],
    body: (e.body || '').replace(/\\n/g, '\n'),
    motif: typeof e.motif === 'string' ? e.motif : '',
    accent: typeof e.accent === 'string' ? e.accent : undefined,
    accent2: typeof e.accent2 === 'string' ? e.accent2 : undefined,
  };
}

async function generateBlogDrafts(
  llm: any,
  transcript: string,
  systemPrompt: string,
  styleGuide: string,
  publishedPosts: PublishedPostRef[] = []
): Promise<BlogGenerationResult[]> {
  const publishedSection = publishedPosts.length > 0
    ? `EXISTING PUBLISHED ESSAYS ON THIS BLOG (use these for cross-linking):
${publishedPosts.map((p) => `- "${p.title}" — /${p.slug}`).join('\n')}

CROSS-LINK RULE (HARD REQUIREMENT):
Each essay's body MUST contain at least one inline markdown link to a relevant existing essay from the list above. Format: [anchor text](/slug). The blog is fully circular — every new essay points to at least one neighbor.
- Choose an essay whose argument is genuinely related, not a random one.
- Anchor text should read naturally inside the sentence, not "click here" or just the title.
- Only link to slugs that appear in the list above. Do not invent slugs.
- Two cross-links are fine when they fit; one is the floor.

`
    : '';

  const prompt = `${systemPrompt}

STYLE GUIDE:
${styleGuide}

${publishedSection}INSTRUCTIONS:
Identify the distinct atomic arguments in this transcript and generate ONE short blog post per argument. Generate between 1 and 3 posts.

How many to generate:
- Default to 1. Most transcripts contain one strong idea — write that single post and stop.
- Generate 2 only if the transcript contains two clearly separable, non-overlapping arguments that each deserve their own atomic essay.
- Generate 3 only if there are three genuinely distinct arguments. Do NOT pad — if the third argument is weak or overlaps the others, drop it.
- Never split a single argument into multiple posts. Never produce variations of the same point.

Each post must stand alone — readable without the others, no cross-references like "as I argued in another post".

Target audience: executive leadership at startups and knowledge-work organizations
Topics: AI agents as software, enterprise AI operationalization, agent mesh/fabric
Voice: business visionary, grounded in building experience

SHAPE OF EACH POST (this is the most important constraint):
- 250-450 words in the body. Hard cap at 500.
- ONE argument, ONE claim. Pick the strongest point and write JUST that.
- 3-5 short paragraphs. NO ## section headers. The post is itself one section.
- Open with the claim or a sharp hook. Close with a forward-looking line or a "what to do" pivot.
- Cut everything that does not directly support the single argument.

Output ONLY valid JSON (no markdown fences, no commentary) with this exact structure:
{
  "essays": [
    {
      "title": "Post Title Here",
      "slug": "short-slug-here",
      "description": "One-sentence summary for SEO/social cards (80-200 chars). Required range — too short fails validation.",
      "tags": ["ai", "software-engineering"],
      "takeaways": ["Key insight 1", "Key insight 2", "Key insight 3"],
      "faq": [
        {"question": "...", "answer": "..."},
        {"question": "...", "answer": "..."}
      ],
      "sources": [
        {"id": "short-kebab-id", "title": "Source Title", "url": "https://..."},
        {"id": "short-kebab-id", "title": "Source Title", "url": "https://..."}
      ],
      "motif": "one of: gap | blocks | flow | layers | mesh | harness | fragments | ascend | pipeline | horizon",
      "body": "Full markdown body here (use \\n for newlines). 250-450 words, no ## headers, single argument."
    }
  ]
}

The "essays" array MUST contain 1, 2, or 3 entries. Never 0, never more than 3.

Rules for slug: 2-5 words, lowercase, hyphenated (e.g. "agents-are-software", "demo-vs-deployment"). Each essay's slug must be different from the others.
Rules for tags: pick 2-4 from [ai, software-engineering, tembo, startups, agents, enterprise].
Rules for description: 80-200 characters. Strict — under 80 or over 200 fails site validation.
Rules for takeaways: exactly 3, one sentence each. NEVER use a bare colon mid-string in a takeaway (it breaks YAML parsing). Use a dash or rephrase.
Rules for faq: exactly 2 entries, question and answer.
Rules for sources: exactly 2 real, verifiable external sources. Use actual URLs that exist (anthropic.com, github.blog, palantir.com, stratechery.com, a16z.com, tembo.io, martinfowler.com — or other URLs you are certain are real). Each id is a short kebab-case identifier.
Rules for motif: pick the geometric cover that best fits the post's core metaphor:
  - gap: bottleneck, chasm, demo-vs-deployment, missing layer
  - blocks: knowledge work as software, code, generation, transformation
  - flow: workflow, scoped agents, sequence, process
  - layers: context, depth, layered systems, organizational layers
  - mesh: distributed, atomic units, decomposition, network
  - harness: interface, framework, container, governance, scaffold
  - fragments: breakage, fragmentation, decay, homegrown failure
  - ascend: growth, scaling, platform expansion, wedge-to-platform
  - pipeline: production, deployment, throughput, factory
  - horizon: long-term, patience, time, future, marathons

TRANSCRIPT TO PROCESS:
${transcript}`;

  const response = await llm.generate(prompt);

  try {
    const cleaned = response.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    let essays: any[];
    if (Array.isArray(parsed.essays)) {
      essays = parsed.essays;
    } else if (Array.isArray(parsed)) {
      essays = parsed;
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
  llm: any
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

function findBlogPosts(
  dirs: string[],
  limitPerDir: number = 5
): Array<{ name: string; path: string; mtime: Date }> {
  // Take top N per directory rather than across the combined set, otherwise
  // a directory with many recently-touched files (drafts) crowds out files
  // from other directories (published posts) entirely.
  const result: Array<{ name: string; path: string; mtime: Date }> = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const dirFiles: Array<{ name: string; path: string; mtime: Date }> = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
        const filePath = join(dir, file);
        dirFiles.push({ name: file, path: filePath, mtime: statSync(filePath).mtime });
      }
      dirFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      result.push(...dirFiles.slice(0, limitPerDir));
    } catch {
      // skip unreadable dirs
    }
  }

  return result;
}

async function updateRelatedBlogPosts(
  llm: any,
  transcript: string,
  contentDirs: string[]
): Promise<Array<{ path: string; updated: boolean }>> {
  const files = findBlogPosts(contentDirs);
  const results: Array<{ path: string; updated: boolean }> = [];

  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf-8');

      const prompt = `Given this new transcript content:

${transcript}

And this existing blog post:

${content}

Does this post need updating based on the new transcript content? If yes, respond with ONLY the updated file content — start with the --- frontmatter delimiter, no preamble, no commentary, no markdown fences. If no, respond with exactly "SKIP".

Only update if the transcript content is genuinely related and would improve the post. Preserve all existing frontmatter fields and formatting exactly.`;

      const response = await llm.generate(prompt);

      const trimmed = response.trim();
      if (trimmed === 'SKIP') {
        results.push({ path: file.path, updated: false });
      } else {
        // Extract the actual file content — find the first --- frontmatter delimiter
        const fmStart = trimmed.indexOf('---');
        if (fmStart >= 0) {
          writeFileSync(file.path, trimmed.slice(fmStart), 'utf-8');
          results.push({ path: file.path, updated: true });
        } else {
          // No valid frontmatter found — don't overwrite
          results.push({ path: file.path, updated: false });
        }
      }
    } catch {
      results.push({ path: file.path, updated: false });
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

    // Step 0: Sync Granola transcripts
    logger.section('[0/3] Syncing Granola transcripts...');
    try {
      await granolaSyncCommand({});
    } catch {
      logger.info('Granola sync skipped (not configured or no new transcripts)');
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

  const systemPrompt = fs.loadPrompt('system.md');
  logger.success('Loaded system prompt');

  const styleGuide = fs.loadPrompt('style.md');
  logger.success('Loaded style guide');

  const workInstructions = fs.loadPrompt('work.md');
  logger.success('Loaded work instructions');

  const bangerEvalTemplate = fs.loadPrompt('banger-eval.md');
  logger.success('Loaded banger evaluation prompt');

  // Load content analysis template (for strategy selection)
  const analysisTemplate = fs.fileExists(join(cwd, 'prompts', 'content-analysis.md'))
    ? fs.loadPrompt('content-analysis.md')
    : '';

  // Load user-defined strategies
  const userStrategies = fs.loadStrategies();
  logger.success(`Loaded ${userStrategies.length} content strategies`);

  // Initialize strategy services
  const contentAnalyzer = analysisTemplate ? new ContentAnalyzer(llm, analysisTemplate) : null;
  const strategySelector = new StrategySelector(
    userStrategies,
    config.generation.strategies?.diversityWeight || 0.7
  );

  // Determine strategy configuration
  const strategiesEnabled =
    !options.noStrategies && (config.generation.strategies?.enabled === true);
  const postCount = options.count || config.generation.postsPerTranscript || 8;

  if (strategiesEnabled && options.verbose) {
    logger.info(`Strategy-based generation enabled (${postCount} posts per file)`);
  }

  const inputFiles = findInputFiles(join(cwd, 'input'));
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
    : inputFiles.filter(f => !fs.isFileProcessed(f, state));
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
    if (!options.force && fs.isFileProcessed(filePath, state)) {
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
        state = fs.markFileProcessed(filePath, 0, state);
        fs.saveState(state);
        totalSkipped++;
        remaining--;
        continue;
      }
    }

    try {
      // Read transcript
      const transcript = readFileSync(filePath, 'utf-8');

      if (transcript.trim().length === 0) {
        logger.info('  Skipped (empty file)');
        continue;
      }

      let postsGenerated = 0;
      let xPostsGenerated = 0;
      let linkedinPostsGenerated = 0;

      // Strategy-based generation
      if (strategiesEnabled) {
        // Determine which strategies to use
        let selectedStrategies;

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
          // Auto-select strategies based on content analysis
          if (contentAnalyzer) {
            if (options.verbose) {
              logger.info('  Analyzing content...');
            }

            const analysis = await contentAnalyzer.analyzeTranscript(transcript);

            if (options.verbose) {
              logger.info(`  Content types: ${analysis.contentTypes.join(', ')}`);
            }

            selectedStrategies = strategySelector.selectStrategies(
              analysis,
              postCount,
              config.generation.strategies?.preferThreadFriendly || false
            );
          } else {
            // No analyzer available, use general-purpose strategies
            selectedStrategies = strategySelector.getAllStrategies().slice(0, postCount);
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

            const strategyPrompt = buildStrategyPrompt(
              systemPrompt,
              styleGuide,
              workInstructions,
              strategy.prompt,
              transcript
            );

            const response = await llm.generate(strategyPrompt);

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
              post.platform = postData.platform || 'x';

              // Add strategy metadata
              post.metadata.strategy = {
                id: strategy.id,
                name: strategy.name,
                category: strategy.category,
              };

              // Evaluate banger potential
              try {
                const evalPrompt = buildBangerEvalPrompt(bangerEvalTemplate, postData.content);
                const evalResponse = await llm.generate(evalPrompt);
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

              fs.appendPost(post);
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
              logger.info(`  ${progress} ✗ No valid post generated`);
            }
          } catch (stratError) {
            logger.info(`  ${progress} ✗ Failed: ${(stratError as Error).message}`);
            if (options.verbose) {
              logger.info(`    Strategy: ${strategy.id}`);
            }
          }
        }
      } else {
        // Direct generation using work.md instructions
        logger.info(`  Generating posts...`);

        const prompt = buildPrompt(systemPrompt, styleGuide, workInstructions, transcript);

        if (options.verbose) {
          logger.info(`  Prompt length: ${prompt.length} characters`);
        }

        const response = await llm.generate(prompt);

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
            const evalResponse = await llm.generate(evalPrompt);
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

          fs.appendPost(post);
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

      // Platform counts are tracked during generation

      const draftsDir = config.blog?.outputDir || 'src/content/drafts';
      const postsDir = join(draftsDir, '..', 'posts');

      // Load published post index so the LLM can cross-link new essays
      const publishedIndex = loadPublishedPostIndex(postsDir);
      if (options.verbose) {
        logger.info(`  Loaded ${publishedIndex.length} published essays for cross-linking`);
      }
      const publishedSlugSet = new Set(publishedIndex.map((p) => p.slug));

      // Generate blog drafts (1-3 atomic essays per transcript)
      logger.info('  Generating blog drafts...');
      const blogResults = await generateBlogDrafts(llm, transcript, systemPrompt, styleGuide, publishedIndex);
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
      const blogDraftCount = blogResults.length;
      for (const result of blogResults) {
        const baseSlug = result.slug || createSlug(result.title);
        let slug = baseSlug;
        let n = 2;
        while (usedSlugs.has(slug)) {
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

      // Update related existing blog posts (drafts + published)
      logger.info('  Checking existing blog posts...');
      const updates = await updateRelatedBlogPosts(llm, transcript, [draftsDir, postsDir]);
      const updatedCount = updates.filter(u => u.updated).length;
      if (updatedCount > 0) {
        logger.success(`  Updated ${updatedCount} related blog post${updatedCount === 1 ? '' : 's'}`);
      }

      // Processing summary
      const summaryParts = [];
      if (xPostsGenerated > 0) summaryParts.push(`${xPostsGenerated} X post${xPostsGenerated === 1 ? '' : 's'}`);
      if (linkedinPostsGenerated > 0) summaryParts.push(`${linkedinPostsGenerated} LinkedIn post${linkedinPostsGenerated === 1 ? '' : 's'}`);
      summaryParts.push(`${blogDraftCount} new blog draft${blogDraftCount === 1 ? '' : 's'}`);
      if (updatedCount > 0) summaryParts.push(`${updatedCount} existing post${updatedCount === 1 ? '' : 's'} updated`);

      logger.info(`  Summary: ${summaryParts.join(', ')}`);
      totalProcessed++;
      totalGenerated += postsGenerated;
      remaining--;

      // Mark file as processed and save immediately
      state = fs.markFileProcessed(filePath, postsGenerated, state);
      fs.saveState(state);

      logger.success(`  ✓ Done — ${remaining} transcript${remaining === 1 ? '' : 's'} remaining`);
    } catch (error) {
      logger.error(`  Failed: ${(error as Error).message}`);
      totalErrors++;
    }
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
  logger.info(`- Posts saved to: posts.jsonl`);

  if (totalGenerated > 0) {
    logger.blank();
    logger.info('Next steps:');
    logger.info('- Review posts in posts.jsonl');
    logger.info('- Run `ship review` to review and stage posts');
  }
  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
