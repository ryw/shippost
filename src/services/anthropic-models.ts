// Verified against https://platform.claude.com/docs/en/about-claude/models/overview
// and /docs/en/models/opus-5-5/migration-guide on 2026-10-05.
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — balanced' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — complex work' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 — demanding reasoning' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast' },
];

// Opt in known legacy families only. Unknown/future model IDs omit sampling
// parameters, instead of relying on a version blacklist that ages poorly.
export const ANTHROPIC_TEMPERATURE_PATTERN = /^(?:claude-haiku-4-5|claude-sonnet-4-[56]|claude-opus-4-[156]|claude-(?:sonnet|opus)-4(?:-0)?|claude-3-7-sonnet|claude-3-5-(?:sonnet|haiku)|claude-3-(?:opus|sonnet|haiku))(?:-\d{8}|-latest)?$/;

export function anthropicSupportsTemperature(model: string): boolean {
  return ANTHROPIC_TEMPERATURE_PATTERN.test(model);
}
