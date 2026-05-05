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
import type { LLMService } from '../services/llm-service.js';
import { granolaSyncCommand } from './granola-sync.js';

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
}

async function generateBlogDraft(
  llm: LLMService,
  transcript: string,
  systemPrompt: string,
  styleGuide: string
): Promise<BlogGenerationResult> {
  const prompt = `${systemPrompt}

STYLE GUIDE:
${styleGuide}

INSTRUCTIONS:
Generate a blog post draft exploring the key themes from this transcript.

Target audience: executive leadership at startups and knowledge-work organizations
Topics: AI agents as software, enterprise AI operationalization, agent mesh/fabric
Length: 800-1500 words
Voice: business visionary, grounded in building experience

Output ONLY valid JSON (no markdown fences, no commentary) with this exact structure:
{
  "title": "Post Title Here",
  "slug": "short-slug-here",
  "description": "One-sentence summary for SEO/social cards (under 160 chars)",
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
  "body": "Full markdown body here (use \\n for newlines)"
}

Rules for the slug: 2-5 words, lowercase, hyphenated (e.g. "agents-are-software", "demo-vs-deployment").
Rules for tags: pick 2-4 from [ai, software-engineering, tembo, startups, agents, enterprise].
Rules for takeaways: exactly 3, one sentence each.
Rules for faq: exactly 2 entries, question and answer.
Rules for sources: 2-4 real, verifiable external sources (articles, papers, blog posts) relevant to the post's themes. Use actual URLs that exist. Each id is a short kebab-case identifier.

TRANSCRIPT TO PROCESS:
${transcript}`;

  const response = await llm.generate(prompt);

  // Parse JSON response
  try {
    // Strip markdown fences if present
    const cleaned = response.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      title: parsed.title || 'Untitled Blog Draft',
      slug: parsed.slug || createSlug(parsed.title || 'untitled'),
      description: parsed.description || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['ai'],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      faq: Array.isArray(parsed.faq) ? parsed.faq : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      body: (parsed.body || '').replace(/\\n/g, '\n'),
    };
  } catch {
    // Fallback: try to extract title and body from markdown response
    const lines = response.trim().split('\n');
    const titleIndex = lines.findIndex((l: string) => l.startsWith('# '));
    const title = titleIndex >= 0 ? lines[titleIndex].substring(2).trim() : 'Untitled Blog Draft';
    const bodyStart = titleIndex >= 0 ? titleIndex + 1 : 0;
    const body = lines.slice(bodyStart).join('\n').trim();

    return {
      title,
      slug: createSlug(title),
      description: '',
      tags: ['ai'],
      takeaways: [],
      faq: [],
      sources: [],
      body,
    };
  }
}

function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim hyphens from start/end
}

function saveBlogDraft(
  outputDir: string,
  result: BlogGenerationResult,
  sourceFile: string
): string {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const slug = result.slug || createSlug(result.title);
  const filename = `${slug}.mdx`;
  const filePath = join(outputDir, filename);

  // Build frontmatter matching published post format
  const tagsYaml = result.tags.map((t: string) => `  - ${t}`).join('\n');
  const takeawaysYaml = result.takeaways.map((t: string) => `  - ${t}`).join('\n');

  let faqYaml = '';
  if (result.faq.length > 0) {
    faqYaml = 'faq:\n' + result.faq.map((f: { question: string; answer: string }) =>
      `  - question: "${f.question}"\n    answer: >-\n      ${f.answer}`
    ).join('\n');
  }

  let sourcesYaml = '';
  if (result.sources.length > 0) {
    sourcesYaml = 'sources:\n' + result.sources.map((s: { id: string; title: string; url: string }) =>
      `  - id: ${s.id}\n    title: "${s.title}"\n    url: ${s.url}`
    ).join('\n');
  }

  const frontmatter = `---
title: "${result.title}"
date: '${today}'
description: >-
  ${result.description}
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

function findBlogPosts(dirs: string[]): Array<{ name: string; path: string; mtime: Date }> {
  const files: Array<{ name: string; path: string; mtime: Date }> = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
        const filePath = join(dir, file);
        files.push({ name: file, path: filePath, mtime: statSync(filePath).mtime });
      }
    } catch {
      // skip unreadable dirs
    }
  }

  return files
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 5);
}

async function updateRelatedBlogPosts(
  llm: LLMService,
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

      // Generate blog draft
      logger.info('  Generating blog draft...');
      const blogResult = await generateBlogDraft(llm, transcript, systemPrompt, styleGuide);
      const blogPath = saveBlogDraft(config.blog?.outputDir || 'src/content/drafts', blogResult, relativePath);
      logger.success(`  Blog draft: ${relative(cwd, blogPath)}`);

      // Update related existing blog posts (drafts + published)
      logger.info('  Checking existing blog posts...');
      const draftsDir = config.blog?.outputDir || 'src/content/drafts';
      const postsDir = join(draftsDir, '..', 'posts');
      const updates = await updateRelatedBlogPosts(llm, transcript, [draftsDir, postsDir]);
      const updatedCount = updates.filter(u => u.updated).length;
      if (updatedCount > 0) {
        logger.success(`  Updated ${updatedCount} related blog post${updatedCount === 1 ? '' : 's'}`);
      }

      // Processing summary
      const summaryParts = [];
      if (xPostsGenerated > 0) summaryParts.push(`${xPostsGenerated} X post${xPostsGenerated === 1 ? '' : 's'}`);
      if (linkedinPostsGenerated > 0) summaryParts.push(`${linkedinPostsGenerated} LinkedIn post${linkedinPostsGenerated === 1 ? '' : 's'}`);
      summaryParts.push('1 new blog draft');
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
