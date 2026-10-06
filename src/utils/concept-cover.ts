/**
 * Generate a concept-tied SVG cover for a blog post via the LLM.
 *
 * Same visual language as the geometric `writeCover` (1600×900, dark navy
 * + grid, single accent color, glowing strokes) but the central motif is
 * picked by the model from the post's title/description/body — so a post
 * about geese gets goose imagery, a post about bottlenecks gets a funnel.
 *
 * Returns the SVG string on success. Throws if the model returns malformed
 * output; callers should catch and fall back to the geometric generator.
 *
 * Prompt + examples mirror rywalker.com/scripts/gen-concept-cover.mjs.
 */

import { FileSystemService } from '../services/file-system.js';
import { renderPrompt } from '../services/social-plan.js';
import type { LLMService } from '../services/llm-service.js';


interface ConceptPost {
  slug: string;
  title: string;
  description: string;
  body: string;
}

function extractSvg(text: string): string {
  let t = text.replace(/^```(?:xml|svg)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const idxXml = t.indexOf('<?xml');
  const idxSvg = t.indexOf('<svg');
  const start = idxXml >= 0 ? idxXml : idxSvg >= 0 ? idxSvg : -1;
  if (start > 0) t = t.slice(start);
  return t;
}

function isWellFormed(svg: string): boolean {
  const trimmed = svg.trim();
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<svg')) return false;
  if (!trimmed.endsWith('</svg>')) return false;
  if (!/viewBox\s*=\s*"0 0 1600 900"/.test(svg)) return false;
  // Reject duplicated attributes on the same tag, which the model sometimes
  // hallucinates (e.g. `<rect x="..." cy="..." x="..." y="..."/>`).
  const tags = svg.match(/<[a-zA-Z][^>]*>/g) || [];
  for (const tag of tags) {
    const attrNames = (tag.match(/\s([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=/g) || [])
      .map((m) => m.trim().replace(/=$/, ''));
    const seen = new Set<string>();
    for (const name of attrNames) {
      if (seen.has(name)) return false;
      seen.add(name);
    }
  }
  return true;
}

/**
 * Generate a concept-tied cover SVG. Returns the SVG string on success.
 * Throws on malformed output — caller should fall back to geometric.
 */
export async function generateConceptCoverSvg(
  llm: LLMService,
  post: ConceptPost
): Promise<string> {
  const response = await llm.generate(renderPrompt(new FileSystemService(process.cwd()).loadPrompt('blog-cover.md'), { ...post, excerpt: post.body.slice(0, 2400) }), 'blog-cover');
  const svg = extractSvg(response);
  if (!isWellFormed(svg)) {
    throw new Error('LLM returned malformed SVG for concept cover');
  }
  // Stamp marker so future tools can detect concept-tied vs geometric.
  return svg.includes('<!-- concept-cover:v1 -->')
    ? svg
    : svg.replace('<svg ', '<!-- concept-cover:v1 -->\n<svg ');
}
