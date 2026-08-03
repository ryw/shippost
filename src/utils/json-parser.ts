function stripCodeFences(input: string): string {
  return input
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractBalancedJson(input: string, startIndex: number): string | null {
  const open = input[startIndex];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < input.length; i++) {
    const char = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return input.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function findJsonCandidates(input: string, openChar: '[' | '{'): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== openChar) continue;
    const candidate = extractBalancedJson(input, i);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export function parseJsonFromResponse<T>(
  response: string,
  validate: (value: unknown) => value is T,
  root: 'array' | 'object' | 'any' = 'any'
): T | null {
  const cleaned = stripCodeFences(response);
  const candidates = [cleaned];

  if (root === 'array' || root === 'any') {
    candidates.push(...findJsonCandidates(cleaned, '['));
  }
  if (root === 'object' || root === 'any') {
    candidates.push(...findJsonCandidates(cleaned, '{'));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (validate(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
