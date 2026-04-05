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
  body: string;
}

async function generateBlogDraft(
  llm: any,
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
Format: start with \`# Title\` on the first line, then markdown body
Length: 800-1500 words
Voice: business visionary, grounded in building experience

TRANSCRIPT TO PROCESS:
${transcript}

Generate a long-form blog draft based on the transcript above.`;

  const response = await llm.generate(prompt);

  // Parse the response to extract title and body
  const lines = response.trim().split('\n');
  let title = 'Untitled Blog Draft';
  let bodyStartIndex = 0;

  if (lines[0].startsWith('# ')) {
    title = lines[0].substring(2).trim();
    bodyStartIndex = 1;
  }

  const body = lines.slice(bodyStartIndex).join('\n').trim();

  return { title, body };
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
  title: string,
  body: string,
  sourceFile: string
): string {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Create filename with current date and slugified title
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const slug = createSlug(title);
  const filename = `${today}_${slug}.md`;
  const filePath = join(outputDir, filename);

  // Create frontmatter
  const frontmatter = `---
title: "${title}"
draft: true
date: ${today}
source: ${sourceFile}
---

${body}`;

  writeFileSync(filePath, frontmatter, 'utf-8');
  return filePath;
}

async function updateRelatedBlogDrafts(
  llm: any,
  transcript: string,
  outputDir: string
): Promise<Array<{ path: string; updated: boolean }>> {
  if (!existsSync(outputDir)) {
    return [];
  }

  const results: Array<{ path: string; updated: boolean }> = [];

  try {
    const files = readdirSync(outputDir)
      .filter(file => file.endsWith('.md'))
      .map(file => ({
        name: file,
        path: join(outputDir, file),
        mtime: statSync(join(outputDir, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Most recent first
      .slice(0, 5); // Limit to 5 most recent drafts

    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf-8');

        // Check if this is a draft (has draft: true in frontmatter)
        if (!content.includes('draft: true')) {
          continue;
        }

        const prompt = `Given this new transcript content:

${transcript}

And this existing blog draft:

${content}

Does this draft need updating based on the new transcript content? If yes, provide the updated content (full markdown with frontmatter). If no, respond with exactly "SKIP".

Only update if the transcript content is genuinely related and would improve the draft.`;

        const response = await llm.generate(prompt);

        if (response.trim() === 'SKIP') {
          results.push({ path: file.path, updated: false });
        } else {
          // Update the file with the new content
          writeFileSync(file.path, response.trim(), 'utf-8');
          results.push({ path: file.path, updated: true });
        }
      } catch (error) {
        // If individual file update fails, continue with others
        results.push({ path: file.path, updated: false });
      }
    }
  } catch (error) {
    // If reading directory fails, return empty results
    return [];
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
    !options.noStrategies && (config.generation.strategies?.enabled !== false);
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
        // Legacy generation (no strategies)
        logger.info(`  Generating posts (legacy mode)...`);

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
      const blogPath = saveBlogDraft(config.blog?.outputDir || 'src/content/drafts', blogResult.title, blogResult.body, relativePath);
      logger.success(`  Blog draft: ${relative(cwd, blogPath)}`);

      // Update related existing drafts
      logger.info('  Checking existing blog drafts...');
      const updates = await updateRelatedBlogDrafts(llm, transcript, config.blog?.outputDir || 'src/content/drafts');
      const updatedCount = updates.filter(u => u.updated).length;
      if (updatedCount > 0) {
        logger.success(`  Updated ${updatedCount} related blog draft${updatedCount === 1 ? '' : 's'}`);
      }

      // Processing summary
      const summaryParts = [];
      if (xPostsGenerated > 0) summaryParts.push(`${xPostsGenerated} X post${xPostsGenerated === 1 ? '' : 's'}`);
      if (linkedinPostsGenerated > 0) summaryParts.push(`${linkedinPostsGenerated} LinkedIn post${linkedinPostsGenerated === 1 ? '' : 's'}`);
      summaryParts.push('1 new blog draft');
      if (updatedCount > 0) summaryParts.push(`${updatedCount} existing draft${updatedCount === 1 ? '' : 's'} updated`);

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
