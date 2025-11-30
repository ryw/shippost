import { join } from 'path';
import { FileSystemService } from '../services/file-system.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { logger } from '../utils/logger.js';
import { isT2pProject } from '../utils/validation.js';

const STYLE_TEMPLATE = `# Posting Style Guide

## Voice & Tone
- [Describe your posting voice: casual, professional, humorous, etc.]
- [Key phrases or expressions you use]

## Brand Guidelines
- [Your personal or company brand values]
- [Topics you focus on]
- [Topics you avoid]

## Format Preferences
- [Preferred post length: short and punchy, detailed threads, etc.]
- [Emoji usage: frequent, occasional, none]
- [Hashtag strategy: none, 1-2 relevant, many]

## Examples of Your Best Posts
1. [Example post 1 that represents your style well]
2. [Example post 2]
3. [Example post 3]

## Target Audience
- [Who you're writing for]
- [What they care about]
- [How they prefer to consume content]
`;

const WORK_TEMPLATE = `# Post Generation Instructions

## Task
Generate social media post ideas from the provided transcript or notes.

## Process
1. Read the entire transcript carefully
2. Identify key insights, quotes, or learnings
3. Extract quotable moments or interesting perspectives
4. Consider multiple angles or takes on the same content

## Output Requirements
- Generate 3-5 post ideas per transcript
- Each post should be self-contained and understandable without context
- Posts should follow the style guide in style.md
- Focus on value: insights, learnings, or interesting perspectives
- Avoid direct transcript copying - transform into engaging posts

## Post Structure
- Hook: Start with something attention-grabbing
- Body: The main insight or story
- Call-to-action or thought-provoking ending (optional)

## Quality Criteria
- Is it interesting to your target audience?
- Does it provide value (insight, entertainment, education)?
- Is it in your authentic voice?
- Would you actually post this?
`;

const SYSTEM_TEMPLATE = `# System Prompt for Post Generation

You are a social media post generator. Your task is to create engaging posts from meeting transcripts.

## Your Role
- Transform raw transcripts into polished social media posts
- Follow the user's style guide and work instructions
- Generate multiple post ideas with different angles
- Ensure posts are self-contained and engaging

## Output Format
Generate 5 social media post ideas. Format your response as a JSON array with each post as an object containing a "content" field.

Example format:
[
  {"content": "First post idea here..."},
  {"content": "Second post idea here..."}
]

## Important Notes
- Stay true to the user's voice from style.md
- Follow the generation instructions from work.md
- Extract the most valuable insights from the transcript
- Make posts standalone - don't assume context

Your response:`;

const ANALYSIS_TEMPLATE = `# Style Analysis Prompt

You are a writing style analyst. Your task is to analyze a collection of tweets from a single author and create a comprehensive style guide that captures their unique voice, patterns, and preferences.

## Analysis Task
Based on the provided tweets, create a detailed style guide following this exact format:

# Posting Style Guide

## Voice & Tone
[Analyze and describe the author's voice and tone. Consider: Are they casual or formal? Professional or conversational? Humorous or serious? Authoritative or humble? Technical or accessible? List specific characteristics you observe.]

## Brand Guidelines
[Identify recurring themes, topics, and values. What does this person consistently talk about? What are their areas of expertise or interest? What topics do they avoid? What values or principles shine through?]

## Format Preferences
[Analyze their posting patterns: Do they prefer short, punchy posts or longer explanations? Do they use threads? How do they use emojis (frequently, sparingly, never)? Do they use hashtags? How? Do they use formatting like line breaks, bullets, or caps?]

## Examples of Your Best Posts
[Select 3-5 of the most representative tweets that showcase their style at its best. Include the full text of these tweets. Choose tweets that demonstrate their voice, engage their audience, and exemplify their typical content.]

## Target Audience
[Infer who they're writing for based on content, tone, and topics. Consider: What's their audience's level of expertise? What do they care about? What problems are they trying to solve? How technical or casual should content be?]

## Important Guidelines
- Be specific and concrete in your analysis
- Use actual examples and patterns you observe
- Avoid generic statements - focus on what makes THIS author unique
- Write in second person ("you write...", "your style...") as this will guide the author
- The style guide should be immediately actionable for content generation
- Include at least 3-5 specific observations in each section
- Quote or reference specific tweets when relevant

Generate the complete style guide now:`;

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const fs = new FileSystemService(cwd);

  // Check if already initialized
  if (isT2pProject(cwd)) {
    logger.error('Already initialized! This directory is already a t2p project.');
    process.exit(1);
  }

  try {
    // Create directories
    fs.ensureDirectory(join(cwd, 'input'));
    logger.success('Created directory: input/');

    fs.ensureDirectory(join(cwd, 'prompts'));
    logger.success('Created directory: prompts/');

    // Create prompt templates
    fs.writeFile(join(cwd, 'prompts', 'style.md'), STYLE_TEMPLATE);
    logger.success('Created file: prompts/style.md');

    fs.writeFile(join(cwd, 'prompts', 'work.md'), WORK_TEMPLATE);
    logger.success('Created file: prompts/work.md');

    fs.writeFile(join(cwd, 'prompts', 'system.md'), SYSTEM_TEMPLATE);
    logger.success('Created file: prompts/system.md');

    fs.writeFile(join(cwd, 'prompts', 'analysis.md'), ANALYSIS_TEMPLATE);
    logger.success('Created file: prompts/analysis.md');

    // Create empty posts.jsonl
    fs.writeFile(join(cwd, 'posts.jsonl'), '');
    logger.success('Created file: posts.jsonl');

    // Create default config
    fs.saveConfig(DEFAULT_CONFIG);
    logger.success('Created configuration: .t2prc.json');

    // Success message
    logger.blank();
    logger.info('t2p initialized successfully!');
    logger.blank();
    logger.info('Next steps:');
    logger.info('1. Edit prompts/style.md to define your posting style');
    logger.info('2. Edit prompts/work.md to customize post generation');
    logger.info('3. (Optional) Edit prompts/system.md and prompts/analysis.md for advanced customization');
    logger.info('4. Add transcript files to input/');
    logger.info('5. Run: t2p work');
  } catch (error) {
    logger.error(`Initialization failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
