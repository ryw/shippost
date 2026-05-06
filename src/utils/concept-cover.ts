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

import type { LLMService } from '../services/llm-service.js';

const PROMPT = `You are designing minimalist editorial SVG covers for a blog about agents, startups, and software.

Every cover MUST follow this exact template:
- viewBox="0 0 1600 900", width 1600, height 900
- Background: dark navy radial gradient (#141a30 → #0b1020) with a faint grid pattern (40px) in #1e2742
- A glow filter for accent strokes
- A single accent color (pick from the palette below)
- A foreground motif of 4–8 geometric elements (paths, lines, circles, polygons) that hints at the post's core metaphor
- A pinch of noise dots in #3a4566 for texture

Accent palette (pick the one that best fits the post's mood/topic):
- amber:    accent="#f59e0b" accent2="#fbbf24"   (cautionary, founder, journey)
- cyan:     accent="#22d3ee" accent2="#67e8f9"   (clarity, mirror, software)
- lime:     accent="#84cc16" accent2="#a3e635"   (growth, race, momentum)
- magenta:  accent="#e879f9" accent2="#f0abfc"   (context, layers, weird)
- teal:     accent="#2dd4bf" accent2="#5eead4"   (mesh, network, harmony)
- coral:    accent="#fb7185" accent2="#fda4af"   (problem, urgency, bottleneck)
- violet:   accent="#a78bfa" accent2="#c4b5fd"   (decay, fragmentation, abstract)
- gold:     accent="#fbbf24" accent2="#fde68a"   (ascension, platform, value)
- azure:    accent="#60a5fa" accent2="#93c5fd"   (pipeline, flow, infrastructure)
- red:      accent="#ef4444" accent2="#fca5a5"   (long game, horizon, dramatic)

Design philosophy:
- Tie the motif to the post's argument or its title's literal imagery — but don't try too hard. If the title is abstract, pick a related symbolic shape. If it has a literal noun (goose, mirror, bottleneck), depict it abstractly.
- Use 4–8 motif elements maximum. Sparse is good.
- Strokes only, no fills (except small dots and the optional glow halo).
- Place the motif in the central area; leave plenty of negative space.
- Include the standard noise-dots block exactly as shown in the examples.
- Stamp the SVG with this comment right after the opening tag: <!-- concept-cover:v1 -->

Output ONLY the SVG XML, starting with <?xml version="1.0" encoding="UTF-8"?>. No commentary, no markdown fences, no <think> blocks.

---

EXAMPLE 1 — slug: follow-no-goose
title: Follow No Goose Absolutely
metaphor: V-formation flock heading forward, with one bird breaking off in the opposite direction; feathers shed where the loner peeled off.

<?xml version="1.0" encoding="UTF-8"?>
<!-- concept-cover:v1 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="80%">
    <stop offset="0%" stop-color="#141a30"/>
    <stop offset="100%" stop-color="#0b1020"/>
  </radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="6" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e2742" stroke-width="0.5"/>
  </pattern>
</defs>
<rect width="1600" height="900" fill="url(#bg)"/>
<rect width="1600" height="900" fill="url(#grid)" opacity="0.6"/>
<g stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">
  <path d="M 1080 420 L 1110 405 L 1140 420" opacity="0.95"/>
  <path d="M 1010 458 L 1040 443 L 1070 458" opacity="0.85"/>
  <path d="M 1010 388 L 1040 373 L 1070 388" opacity="0.85"/>
  <path d="M 940 496 L 970 481 L 1000 496" opacity="0.7"/>
  <path d="M 940 354 L 970 339 L 1000 354" opacity="0.7"/>
  <path d="M 870 534 L 900 519 L 930 534" opacity="0.55"/>
  <path d="M 870 320 L 900 305 L 930 320" opacity="0.55"/>
</g>
<g stroke="#fbbf24" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">
  <path d="M 1340 610 L 1370 625 L 1400 610" opacity="1"/>
</g>
<g fill="#f59e0b" opacity="0.5">
  <circle cx="1180" cy="470" r="2.5"/><circle cx="1220" cy="500" r="2"/>
  <circle cx="1260" cy="535" r="1.8"/><circle cx="1295" cy="568" r="1.6"/>
  <circle cx="1320" cy="592" r="1.4"/>
</g>
<circle cx="1480" cy="240" r="3" fill="#fbbf24" opacity="0.6" filter="url(#glow)"/>
<g fill="#3a4566">
  <circle cx="120" cy="780" r="1.0" opacity="0.18"/><circle cx="280" cy="640" r="0.8" opacity="0.14"/>
  <circle cx="420" cy="120" r="1.2" opacity="0.20"/><circle cx="540" cy="800" r="0.6" opacity="0.12"/>
  <circle cx="680" cy="220" r="1.0" opacity="0.16"/><circle cx="800" cy="700" r="0.8" opacity="0.14"/>
  <circle cx="1100" cy="160" r="1.0" opacity="0.18"/><circle cx="1240" cy="800" r="0.8" opacity="0.16"/>
  <circle cx="1380" cy="100" r="1.2" opacity="0.20"/><circle cx="1500" cy="700" r="0.8" opacity="0.14"/>
  <circle cx="180" cy="200" r="0.6" opacity="0.10"/><circle cx="600" cy="60" r="1.0" opacity="0.16"/>
  <circle cx="900" cy="850" r="0.8" opacity="0.14"/><circle cx="1450" cy="450" r="0.6" opacity="0.10"/>
  <circle cx="60" cy="450" r="1.0" opacity="0.16"/>
</g>
</svg>

---

EXAMPLE 2 — slug: code-review-becomes-the-bottleneck
title: Code Review Becomes the Bottleneck
metaphor: Wide stream of inputs funneling into a narrow gate (the bottleneck), thin trickle out the other side, backed-up dots clustering before the gate.

<?xml version="1.0" encoding="UTF-8"?>
<!-- concept-cover:v1 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#141a30"/><stop offset="100%" stop-color="#0b1020"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e2742" stroke-width="0.5"/></pattern>
</defs>
<rect width="1600" height="900" fill="url(#bg)"/>
<rect width="1600" height="900" fill="url(#grid)" opacity="0.6"/>
<g stroke="#fb7185" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7" filter="url(#glow)">
  <line x1="120" y1="200" x2="640" y2="430"/><line x1="120" y1="280" x2="640" y2="440"/>
  <line x1="120" y1="360" x2="640" y2="450"/><line x1="120" y1="440" x2="640" y2="455"/>
  <line x1="120" y1="520" x2="640" y2="460"/><line x1="120" y1="600" x2="640" y2="470"/>
  <line x1="120" y1="680" x2="640" y2="480"/><line x1="120" y1="760" x2="640" y2="490"/>
</g>
<g stroke="#fda4af" stroke-width="3" fill="none" stroke-linecap="round" filter="url(#glow)">
  <path d="M 700 380 L 660 450 L 700 520"/><path d="M 760 380 L 800 450 L 760 520"/>
</g>
<circle cx="730" cy="450" r="12" fill="#fb7185" opacity="0.5" filter="url(#glow)"/>
<g stroke="#fb7185" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6" filter="url(#glow)">
  <line x1="820" y1="450" x2="1480" y2="450"/>
  <line x1="820" y1="440" x2="1480" y2="430" opacity="0.5"/>
  <line x1="820" y1="460" x2="1480" y2="470" opacity="0.5"/>
</g>
<g fill="#fb7185" opacity="0.5">
  <circle cx="600" cy="400" r="3"/><circle cx="620" cy="420" r="2.5"/>
  <circle cx="610" cy="445" r="3"/><circle cx="630" cy="465" r="2.5"/>
  <circle cx="600" cy="490" r="3"/><circle cx="580" cy="420" r="2"/>
  <circle cx="580" cy="475" r="2"/><circle cx="565" cy="450" r="2.5"/>
</g>
<g fill="#3a4566">
  <circle cx="120" cy="780" r="1.0" opacity="0.18"/><circle cx="280" cy="640" r="0.8" opacity="0.14"/>
  <circle cx="420" cy="120" r="1.2" opacity="0.20"/><circle cx="540" cy="800" r="0.6" opacity="0.12"/>
  <circle cx="680" cy="220" r="1.0" opacity="0.16"/><circle cx="800" cy="700" r="0.8" opacity="0.14"/>
  <circle cx="1100" cy="160" r="1.0" opacity="0.18"/><circle cx="1240" cy="800" r="0.8" opacity="0.16"/>
  <circle cx="1380" cy="100" r="1.2" opacity="0.20"/><circle cx="1500" cy="700" r="0.8" opacity="0.14"/>
  <circle cx="180" cy="200" r="0.6" opacity="0.10"/><circle cx="600" cy="60" r="1.0" opacity="0.16"/>
  <circle cx="900" cy="850" r="0.8" opacity="0.14"/><circle cx="1450" cy="450" r="0.6" opacity="0.10"/>
  <circle cx="60" cy="450" r="1.0" opacity="0.16"/>
</g>
</svg>

---

Now generate the cover for the post below.`;

interface ConceptPost {
  slug: string;
  title: string;
  description: string;
  body: string;
}

function buildPrompt(post: ConceptPost): string {
  const excerpt = post.body.slice(0, 2400); // ~600 words
  return `${PROMPT}

slug: ${post.slug}
title: ${post.title}
description: ${post.description}

opening of body:
${excerpt}

Pick the accent color that best fits the mood. Tie the motif to the post's core metaphor. Don't try too hard — abstract is fine. Output only the SVG.`;
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
  const response = await llm.generate(buildPrompt(post));
  const svg = extractSvg(response);
  if (!isWellFormed(svg)) {
    throw new Error('LLM returned malformed SVG for concept cover');
  }
  // Stamp marker so future tools can detect concept-tied vs geometric.
  return svg.includes('<!-- concept-cover:v1 -->')
    ? svg
    : svg.replace('<svg ', '<!-- concept-cover:v1 -->\n<svg ');
}
