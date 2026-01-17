import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { isShippostProject } from '../utils/validation.js';
import { NotInitializedError } from '../utils/errors.js';

interface GranolaSyncOptions {
  count?: number;
  force?: boolean;
}

interface GranolaDocument {
  id: string;
  title: string;
  created_at: string;
  transcribe?: boolean;
}

interface GranolaSyncState {
  syncedDocuments: Record<string, {
    syncedAt: string;
    filename: string;
  }>;
}

const GRANOLA_DIR = join(homedir(), 'Library/Application Support/Granola');
const STATE_FILE = '.granola-sync-state.json';

function loadGranolaAuth(): string {
  const authPath = join(GRANOLA_DIR, 'supabase.json');
  if (!existsSync(authPath)) {
    throw new Error('Granola not found. Make sure Granola app is installed and you are logged in.');
  }

  const authData = JSON.parse(readFileSync(authPath, 'utf-8'));
  const tokens = JSON.parse(authData.workos_tokens);
  return tokens.access_token;
}

function loadGranolaDocuments(): Record<string, GranolaDocument> {
  const cachePath = join(GRANOLA_DIR, 'cache-v3.json');
  if (!existsSync(cachePath)) {
    throw new Error('Granola cache not found. Open Granola app to sync your meetings first.');
  }

  const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
  const cache = JSON.parse(data.cache);
  return cache.state.documents;
}

function loadSyncState(cwd: string): GranolaSyncState {
  const statePath = join(cwd, STATE_FILE);
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  }
  return { syncedDocuments: {} };
}

function saveSyncState(cwd: string, state: GranolaSyncState): void {
  const statePath = join(cwd, STATE_FILE);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function fetchTranscript(accessToken: string, docId: string): Promise<string[] | null> {
  const response = await fetch('https://api.granola.ai/v1/get-document-transcript', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Granola/5.354.0',
      'X-Client-Version': '5.354.0',
    },
    body: JSON.stringify({ document_id: docId }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  // Node's fetch automatically decompresses gzip
  const utterances = await response.json();

  if (!Array.isArray(utterances) || utterances.length === 0) {
    return null;
  }

  return utterances
    .map((u: { text?: string }) => u.text?.trim())
    .filter((text: string | undefined): text is string => !!text);
}

function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // Remove special chars
    .replace(/\s+/g, '_')          // Spaces to underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .replace(/^_|_$/g, '');        // Trim leading/trailing underscores
}

/**
 * Clean up Granola meeting titles by removing common prefixes and user names
 * Works for any user - extracts participant names dynamically
 */
function cleanMeetingTitle(title: string): string {
  let name = title;

  // Remove common meeting platform prefixes
  // e.g., "Virtual Meeting (Zoom) between Alice and Bob" -> "Alice and Bob"
  name = name.replace(/^Virtual Meeting \(.*?\) between /i, '');
  name = name.replace(/^Meeting between /i, '');
  name = name.replace(/^Call with /i, '');
  name = name.replace(/^1:1 with /i, '');

  // For two-person meetings, take just the other person's name
  // "Alice and Bob" -> "Alice" or "Bob" (takes first)
  // This works regardless of who the user is
  const andMatch = name.match(/^(.+?) and (.+)$/i);
  if (andMatch) {
    // Take the shorter name (usually a person's name vs "You" or username)
    const [, person1, person2] = andMatch;
    name = person1.length <= person2.length ? person1 : person2;
  }

  return name.trim();
}

function generateFilename(doc: GranolaDocument): string {
  const date = doc.created_at.slice(0, 10); // YYYY-MM-DD

  // Clean up the meeting title
  const cleanedTitle = cleanMeetingTitle(doc.title);

  // Truncate long names
  const snakeName = toSnakeCase(cleanedTitle).slice(0, 50);

  return `${date}_${snakeName}.txt`;
}

export async function granolaSyncCommand(options: GranolaSyncOptions): Promise<void> {
  const cwd = process.cwd();
  const { style } = logger;

  try {
    if (!isShippostProject(cwd)) {
      throw new NotInitializedError();
    }

    logger.section('Granola Sync');

    // Load Granola data
    logger.step('Loading Granola credentials...');
    const accessToken = loadGranolaAuth();

    logger.step('Loading Granola documents...');
    const documents = loadGranolaDocuments();
    const docCount = Object.keys(documents).length;
    logger.info(`Found ${docCount} documents in Granola`);

    // Load sync state
    const syncState = loadSyncState(cwd);
    const alreadySynced = new Set(Object.keys(syncState.syncedDocuments));

    // Ensure input directory exists
    const inputDir = join(cwd, 'input');
    if (!existsSync(inputDir)) {
      mkdirSync(inputDir, { recursive: true });
    }

    // Filter to unsynced documents
    let docsToSync = Object.entries(documents)
      .filter(([id]) => options.force || !alreadySynced.has(id))
      .sort((a, b) => b[1].created_at.localeCompare(a[1].created_at)); // Newest first

    if (options.count) {
      docsToSync = docsToSync.slice(0, options.count);
    }

    if (docsToSync.length === 0) {
      logger.success('All documents already synced!');
      return;
    }

    logger.info(`Syncing ${docsToSync.length} new documents...`);
    logger.blank();

    let synced = 0;
    let noTranscript = 0;
    let errors = 0;

    for (const [docId, doc] of docsToSync) {
      const displayTitle = doc.title.length > 50
        ? doc.title.slice(0, 47) + '...'
        : doc.title;

      process.stdout.write(`  ${style.dim(`[${synced + noTranscript + errors + 1}/${docsToSync.length}]`)} ${displayTitle}... `);

      try {
        const transcript = await fetchTranscript(accessToken, docId);

        if (transcript && transcript.length > 0) {
          const filename = generateFilename(doc);
          const filepath = join(inputDir, filename);

          const content = transcript.join('\n\n');
          writeFileSync(filepath, content);

          syncState.syncedDocuments[docId] = {
            syncedAt: new Date().toISOString(),
            filename,
          };

          console.log(style.green('✓ saved'));
          synced++;
        } else {
          console.log(style.dim('no transcript'));
          noTranscript++;

          // Still mark as synced to avoid retrying
          syncState.syncedDocuments[docId] = {
            syncedAt: new Date().toISOString(),
            filename: '',
          };
        }
      } catch (err) {
        console.log(style.red(`error: ${(err as Error).message}`));
        errors++;
      }
    }

    // Save state
    saveSyncState(cwd, syncState);

    logger.blank();
    logger.success(`Synced ${synced} transcripts to input/`);
    if (noTranscript > 0) {
      logger.info(`${noTranscript} documents had no transcript`);
    }
    if (errors > 0) {
      logger.error(`${errors} errors occurred`);
    }

  } catch (error) {
    logger.blank();
    logger.error((error as Error).message);
    process.exit(1);
  }
}
