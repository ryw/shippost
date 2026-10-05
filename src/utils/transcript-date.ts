/** Prefer recorded meeting metadata; older imports encode YYYY-MM-DD in filenames.
 * Never use mtime: copying/restoring the workspace changes it for old meetings.
 */
export function transcriptDate(filename: string, recordedDate?: string): string | undefined {
  const date = (recordedDate || filename).match(/^(\d{4}-\d{2}-\d{2})(?=$|[T_. -])/)?.[1];
  if (!date) return undefined;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : undefined;
}

/** Thirty UTC calendar dates, including today. Undated and future meetings wait in All dates. */
export function inLast30Days(date: string | undefined, now = new Date()): boolean {
  if (!date) return false;
  const today = now.toISOString().slice(0, 10);
  const start = new Date(today + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 29);
  return date >= start.toISOString().slice(0, 10) && date <= today;
}
