/**
 * Shared formatting utilities for consistent display across the application.
 * Consolidates duplicate formatting functions from stats.ts and reply.ts.
 */

/**
 * Format a number with K/M suffixes for display.
 * @param n - The number to format
 * @returns Formatted string (e.g., "1.5K", "2.3M", "500")
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/**
 * Format an optional count value with K/M suffixes.
 * Returns '0' for undefined/null values.
 * @param count - The count to format (may be undefined or null)
 * @returns Formatted string (e.g., "1.5K", "2.3M", "0")
 */
export function formatCount(count?: number | null): string {
  if (count === undefined || count === null) return '0';
  return formatNumber(count);
}

/**
 * Format a percentage value with 2 decimal places.
 * @param n - The percentage value
 * @returns Formatted string (e.g., "12.34%")
 */
export function formatPercent(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * Truncate a string to a maximum length, replacing newlines with spaces.
 * Adds an ellipsis if truncated.
 * @param str - The string to truncate
 * @param len - Maximum length
 * @returns Truncated string
 */
export function truncate(str: string, len: number): string {
  const oneLine = str.replace(/\n/g, ' ').trim();
  if (oneLine.length <= len) return oneLine;
  return oneLine.slice(0, len - 1) + '…';
}

/**
 * Format a relative time string (e.g., "2h ago", "3d ago").
 * @param dateStr - ISO date string
 * @returns Relative time string
 */
export function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return '1d ago';
  return `${diffDays}d ago`;
}

/**
 * Format an hour (0-23) to 12-hour format with AM/PM.
 * @param hour - Hour in 24-hour format (0-23)
 * @returns Formatted string (e.g., "9AM", "2PM")
 */
export function formatHour(hour: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}${ampm}`;
}

/**
 * Render a sparkline chart from an array of values.
 * @param values - Array of numeric values
 * @returns Unicode sparkline string
 */
export function renderSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (chars.length - 1));
    return chars[idx];
  }).join('');
}

/**
 * Render a progress bar.
 * @param current - Current value
 * @param goal - Target/goal value
 * @param width - Width of the bar in characters
 * @param style - Style object with color functions
 * @returns Styled progress bar string
 */
export function renderProgressBar(
  current: number,
  goal: number,
  width: number,
  style: {
    red: (s: string) => string;
    yellow: (s: string) => string;
    brightGreen: (s: string) => string;
    dim: (s: string) => string;
  }
): string {
  const pct = Math.min(1, current / goal);
  const filled = Math.round(pct * width);
  const empty = width - filled;

  let color = style.red;
  if (pct >= 1) color = style.brightGreen;
  else if (pct >= 0.25) color = style.yellow;

  return color('█'.repeat(filled)) + style.dim('░'.repeat(empty));
}

/**
 * Pad a string to a specific width, accounting for ANSI escape codes.
 * @param str - The string to pad
 * @param width - Target width
 * @returns Padded string
 */
export function padWithAnsi(str: string, width: number): string {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);
  return str + ' '.repeat(padding);
}
