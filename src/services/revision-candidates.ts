import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { LLMService } from './llm-service.js';
import { isRecord, parseJsonFromResponse } from '../utils/json-parser.js';
import { renderPrompt } from './social-plan.js';

export interface RevisionCandidate { name: string; path: string; title: string; description: string }
function field(frontmatter: string, name: string): string {
  return (frontmatter.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\n[ \\t]+.*)*)`, 'm'))?.[1] || '').replace(/^[>|][-+]?\s*/, '').replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').trim();
}
function source(content: string): string { return field(content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '', 'source'); }
/** Every published essay is eligible, regardless of checkout time or publication date. */
export function revisionCatalog(postsDir: string, draftsDir: string, sourceFile: string): RevisionCandidate[] {
  const sameMeeting = new Set<string>();
  if (existsSync(draftsDir)) for (const name of readdirSync(draftsDir).filter(n => /\.mdx?$/.test(n))) {
    if (basename(source(readFileSync(join(draftsDir, name), 'utf8'))) === basename(sourceFile)) sameMeeting.add(name.replace(/\.mdx?$/, ''));
  }
  if (!existsSync(postsDir)) return [];
  return readdirSync(postsDir).filter(name => /\.mdx?$/.test(name)).sort().flatMap(name => {
    const path = join(postsDir, name), content = readFileSync(path, 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
    if (sameMeeting.has(name.replace(/\.mdx?$/, '')) || basename(source(content)) === basename(sourceFile) || /^draft:\s*true\s*$/m.test(fm)) return [];
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
    return [{ name, path, title: field(fm, 'title') || name, description: (field(fm, 'description') || body).slice(0, 500) }];
  });
}
export async function discoverRevisionCandidates(llm: LLMService, catalog: RevisionCandidate[], transcript: string, template: string): Promise<RevisionCandidate[]> {
  if (catalog.length <= 8) return catalog;
  const response = await llm.generate(renderPrompt(template, { transcript, articles: JSON.stringify(catalog.map((article, index) => ({ id: String(index), title: article.title, description: article.description }))) }), 'revision-discovery');
  const plan = parseJsonFromResponse(response, isRecord, 'object');
  if (!plan || !Array.isArray(plan.articles) || plan.articles.length > 8) throw new Error('Invalid revision discovery shortlist');
  const selected = new Set<number>();
  for (const item of plan.articles) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^(0|[1-9]\d*)$/.test(item.id) || Number(item.id) >= catalog.length || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('Invalid revision discovery candidate');
    selected.add(Number(item.id));
  }
  return [...selected].map(index => catalog[index]);
}
