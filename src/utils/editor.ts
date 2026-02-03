import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * List of known safe editor basenames.
 * These are common text editors that are safe to invoke.
 */
const SAFE_EDITOR_BASENAMES = new Set([
  'vim',
  'vi',
  'nvim',
  'neovim',
  'nano',
  'emacs',
  'code',
  'codium',
  'vscodium',
  'subl',
  'sublime',
  'sublime_text',
  'atom',
  'gedit',
  'kate',
  'kwrite',
  'mousepad',
  'leafpad',
  'pluma',
  'xed',
  'notepadqq',
  'micro',
  'ne',
  'joe',
  'jed',
  'pico',
  'ed',
  'ex',
  'hx',    // Helix
  'helix',
  'zed',
]);

/**
 * Default editor to use when no valid editor is found.
 */
const DEFAULT_EDITOR = 'vim';

/**
 * Characters that indicate potential command injection attempts.
 * These should never appear in a valid editor command.
 */
const DANGEROUS_CHARS = /[;&|`$(){}[\]<>\\'"!#*?\n\r]/;

/**
 * Validates and resolves a safe editor path from environment variables.
 *
 * Security: This function prevents command injection attacks via EDITOR/VISUAL
 * environment variables by:
 * 1. Checking for dangerous shell metacharacters
 * 2. Validating the editor basename against a whitelist of known editors
 * 3. Using `which` to resolve the actual executable path
 *
 * @returns Object with the resolved editor path and any arguments
 */
export function getSafeEditor(): { command: string; args: string[] } {
  const requestedEditor = process.env.VISUAL || process.env.EDITOR || DEFAULT_EDITOR;

  // Check for dangerous characters that indicate injection attempts
  if (DANGEROUS_CHARS.test(requestedEditor)) {
    console.warn(`Warning: Editor "${requestedEditor}" contains unsafe characters, using ${DEFAULT_EDITOR}`);
    return resolveEditorPath(DEFAULT_EDITOR);
  }

  // Split by spaces to handle editors with arguments (e.g., "code --wait")
  const parts = requestedEditor.trim().split(/\s+/);
  const editorPath = parts[0];
  const editorArgs = parts.slice(1);

  // Get the basename of the editor (handles full paths like /usr/bin/vim)
  const editorBasename = path.basename(editorPath).toLowerCase();

  // Check if it's a known safe editor
  if (!SAFE_EDITOR_BASENAMES.has(editorBasename)) {
    console.warn(`Warning: Unknown editor "${editorBasename}", using ${DEFAULT_EDITOR}`);
    return resolveEditorPath(DEFAULT_EDITOR);
  }

  // Validate each argument doesn't contain dangerous characters
  for (const arg of editorArgs) {
    if (DANGEROUS_CHARS.test(arg)) {
      console.warn(`Warning: Editor arguments contain unsafe characters, using ${DEFAULT_EDITOR}`);
      return resolveEditorPath(DEFAULT_EDITOR);
    }
  }

  // Resolve the actual path using 'which'
  const resolved = resolveEditorPath(editorBasename);

  return {
    command: resolved.command,
    args: [...resolved.args, ...editorArgs],
  };
}

/**
 * Resolves an editor basename to its full path using 'which'.
 * Falls back to the basename itself if 'which' fails.
 */
function resolveEditorPath(editorBasename: string): { command: string; args: string[] } {
  const result = spawnSync('which', [editorBasename], {
    encoding: 'utf8',
    timeout: 5000,
  });

  if (result.status === 0 && result.stdout) {
    const resolvedPath = result.stdout.trim();
    // Verify the resolved path doesn't contain dangerous characters
    if (!DANGEROUS_CHARS.test(resolvedPath)) {
      return { command: resolvedPath, args: [] };
    }
  }

  // Fall back to basename - spawnSync will search PATH
  return { command: editorBasename, args: [] };
}

/**
 * Opens a file in the user's preferred editor.
 *
 * Security: Uses getSafeEditor() to validate the editor command before execution.
 *
 * @param filePath - Path to the file to edit
 * @returns The exit status of the editor process
 */
export function openInEditor(filePath: string): { status: number | null; error?: Error } {
  const editor = getSafeEditor();

  try {
    const result = spawnSync(editor.command, [...editor.args, filePath], {
      stdio: 'inherit',
    });

    return { status: result.status };
  } catch (error) {
    return { status: null, error: error as Error };
  }
}

/**
 * Gets a display name for the current editor (for UI purposes).
 */
export function getEditorDisplayName(): string {
  const editor = getSafeEditor();
  return path.basename(editor.command);
}
