import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptDate, inLast30Days } from '../dist/utils/transcript-date.js';

test('meeting dates come from metadata or dated filenames, never copy time', () => {
  assert.equal(transcriptDate('2020-01-02_old.txt'), '2020-01-02');
  assert.equal(transcriptDate('undated.txt', '2026-10-05T09:00:00Z'), '2026-10-05');
  assert.equal(transcriptDate('2020-01-02_old.txt', '2026-10-05'), '2026-10-05');
  for (const filename of ['undated.txt', '2026-02-30_bad.txt', '2026-99-01_bad.txt']) assert.equal(transcriptDate(filename), undefined);
});

test('past 30 days covers today and preceding 29 UTC dates', () => {
  const now = new Date('2026-10-05T13:30:00Z');
  assert.equal(inLast30Days('2026-10-05', now), true);
  assert.equal(inLast30Days('2026-09-06', now), true);
  for (const date of ['2026-09-05', '2026-10-06', '2020-01-02', undefined]) assert.equal(inLast30Days(date, now), false);
  assert.equal(inLast30Days('2025-12-07', new Date('2026-01-05T00:00:00Z')), true);
});
