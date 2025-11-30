#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { workCommand } from './commands/work.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('t2p')
  .description('Process meeting transcripts and other notes into social media post drafts')
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize a new t2p project in the current directory')
  .action(initCommand);

program
  .command('work')
  .description('Process input files and generate social media posts')
  .option('-m, --model <model>', 'Override Ollama model')
  .option('-v, --verbose', 'Verbose output')
  .action(workCommand);

program.parse();
