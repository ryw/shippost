import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { logger } from '../utils/logger.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SyncPromptsOptions {
  force?: boolean;
}

function getTemplatesDir(): string {
  return join(__dirname, '../templates');
}

function getPromptsDir(cwd: string): string {
  return join(cwd, 'prompts');
}

function diffLines(a: string, b: string): { added: string[]; removed: string[]; same: boolean } {
  const linesA = a.split('\n');
  const linesB = b.split('\n');

  const added: string[] = [];
  const removed: string[] = [];

  // Simple line-by-line diff
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    const lineA = linesA[i];
    const lineB = linesB[i];

    if (lineA !== lineB) {
      if (lineA !== undefined) removed.push(`- ${lineA}`);
      if (lineB !== undefined) added.push(`+ ${lineB}`);
    }
  }

  return { added, removed, same: added.length === 0 && removed.length === 0 };
}

async function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function syncPromptsCommand(options: SyncPromptsOptions): Promise<void> {
  const cwd = process.cwd();
  const { style } = logger;

  try {
    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }

    const templatesDir = getTemplatesDir();
    const promptsDir = getPromptsDir(cwd);

    if (!existsSync(templatesDir)) {
      logger.error('Templates directory not found');
      process.exit(1);
    }

    // Get all template files (excluding strategies.json which is different)
    const templateFiles = readdirSync(templatesDir)
      .filter(f => f.endsWith('.md'));

    logger.info(style.bold('Comparing prompts with package defaults...\n'));

    const outdated: { file: string; template: string; local: string }[] = [];
    const missing: string[] = [];
    const upToDate: string[] = [];

    for (const file of templateFiles) {
      const templatePath = join(templatesDir, file);
      const localPath = join(promptsDir, file);

      const templateContent = readFileSync(templatePath, 'utf8');

      if (!existsSync(localPath)) {
        missing.push(file);
        continue;
      }

      const localContent = readFileSync(localPath, 'utf8');
      const diff = diffLines(localContent, templateContent);

      if (diff.same) {
        upToDate.push(file);
      } else {
        outdated.push({ file, template: templateContent, local: localContent });
      }
    }

    // Report status
    if (upToDate.length > 0) {
      logger.info(`${style.green('✓')} Up to date: ${upToDate.map(f => style.dim(f)).join(', ')}`);
    }

    if (missing.length > 0) {
      logger.info(`${style.yellow('○')} Missing: ${missing.map(f => style.yellow(f)).join(', ')}`);
    }

    if (outdated.length === 0 && missing.length === 0) {
      logger.success('\nAll prompts are up to date!');
      return;
    }

    // Show diffs for outdated files
    for (const { file, template, local } of outdated) {
      const diff = diffLines(local, template);

      logger.blank();
      logger.info(`${style.red('≠')} ${style.bold(file)} differs from package default:`);

      // Show a few lines of diff
      const maxLines = 6;
      const allChanges = [...diff.removed, ...diff.added];
      const shown = allChanges.slice(0, maxLines);

      for (const line of shown) {
        if (line.startsWith('+')) {
          logger.info(style.green(`  ${line}`));
        } else {
          logger.info(style.red(`  ${line}`));
        }
      }

      if (allChanges.length > maxLines) {
        logger.info(style.dim(`  ... and ${allChanges.length - maxLines} more lines`));
      }
    }

    // Prompt to sync
    if (options.force) {
      // Force update all
      for (const { file, template } of outdated) {
        const localPath = join(promptsDir, file);
        writeFileSync(localPath, template);
        logger.success(`Updated ${file}`);
      }
      for (const file of missing) {
        const templatePath = join(templatesDir, file);
        const localPath = join(promptsDir, file);
        writeFileSync(localPath, readFileSync(templatePath, 'utf8'));
        logger.success(`Created ${file}`);
      }
    } else {
      logger.blank();

      // Update outdated files
      for (const { file, template } of outdated) {
        const shouldUpdate = await promptYesNo(`Update ${style.bold(file)} to package default?`);
        if (shouldUpdate) {
          const localPath = join(promptsDir, file);
          writeFileSync(localPath, template);
          logger.success(`Updated ${file}`);
        } else {
          logger.info(style.dim(`Skipped ${file}`));
        }
      }

      // Create missing files
      for (const file of missing) {
        const shouldCreate = await promptYesNo(`Create missing ${style.bold(file)}?`);
        if (shouldCreate) {
          const templatePath = join(templatesDir, file);
          const localPath = join(promptsDir, file);
          writeFileSync(localPath, readFileSync(templatePath, 'utf8'));
          logger.success(`Created ${file}`);
        }
      }
    }

    logger.blank();
    logger.success('Sync complete!');

  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
