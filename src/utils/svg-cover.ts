/**
 * SVG editorial cover generator. Produces 1600x900 abstract covers in a
 * cohesive design language: dark navy base, fine grid, single accent color,
 * one of ten geometric motifs picked to match the post's theme.
 *
 * Ported from rywalker.com/scripts/gen-post-covers.py.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export type Motif =
  | 'gap'
  | 'blocks'
  | 'flow'
  | 'layers'
  | 'mesh'
  | 'harness'
  | 'fragments'
  | 'ascend'
  | 'pipeline'
  | 'horizon';

export const MOTIFS: ReadonlyArray<Motif> = [
  'gap',
  'blocks',
  'flow',
  'layers',
  'mesh',
  'harness',
  'fragments',
  'ascend',
  'pipeline',
  'horizon',
];

export const MOTIF_GUIDE: Record<Motif, string> = {
  gap: 'two structures with a broken bridge — for posts about chasms, bottlenecks, demo-vs-deployment, missing layers',
  blocks: 'code/text blocks transforming into structured cells — for posts about knowledge work, software, generation',
  flow: 'connected hex nodes in a chain — for posts about workflows, scoped agents, sequence, processes',
  layers: 'concentric rings around a center — for posts about context, depth, layered systems, organizational layers',
  mesh: 'irregular network grid with nodes — for posts about mesh, atomic units, distributed systems, decomposition',
  harness: 'scaffold frame around a core — for posts about interfaces, harness, framework, container, governance',
  fragments: 'scattered tilted rectangles with a crack line — for posts about breakage, fragmentation, decay, homegrown failure',
  ascend: 'expanding stages from small to large — for posts about growth, scaling, platform expansion, wedge-to-platform',
  pipeline: 'horizontal pipelines with stations — for posts about production, deployment, throughput, pipelines',
  horizon: 'horizon line with perspective lines and a sun — for posts about long-term, patience, time, future, marathons',
};

export const ACCENTS: ReadonlyArray<{ accent: string; accent2: string; name: string }> = [
  { accent: '#f59e0b', accent2: '#fbbf24', name: 'amber' },
  { accent: '#22d3ee', accent2: '#67e8f9', name: 'cyan' },
  { accent: '#84cc16', accent2: '#a3e635', name: 'lime' },
  { accent: '#e879f9', accent2: '#f0abfc', name: 'magenta' },
  { accent: '#2dd4bf', accent2: '#5eead4', name: 'teal' },
  { accent: '#fb7185', accent2: '#fda4af', name: 'coral' },
  { accent: '#a78bfa', accent2: '#c4b5fd', name: 'violet' },
  { accent: '#fbbf24', accent2: '#fde68a', name: 'gold' },
  { accent: '#60a5fa', accent2: '#93c5fd', name: 'azure' },
  { accent: '#ef4444', accent2: '#fca5a5', name: 'red' },
];

const W = 1600;
const H = 900;
const BASE_BG = '#0b1020';
const BASE_BG_2 = '#141a30';
const GRID_COLOR = '#1e2742';

// Deterministic small PRNG so the same slug always produces the same cover.
function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function randFloat(rng: () => number, lo: number, hi: number): number {
  return rng() * (hi - lo) + lo;
}

function defs(accent: string, accent2: string): string {
  return `<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="80%">
    <stop offset="0%" stop-color="${BASE_BG_2}"/>
    <stop offset="100%" stop-color="${BASE_BG}"/>
  </radialGradient>
  <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${accent}" stop-opacity="1"/>
    <stop offset="100%" stop-color="${accent2}" stop-opacity="0.4"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="6" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${GRID_COLOR}" stroke-width="0.5"/>
  </pattern>
</defs>`;
}

function background(): string {
  return `<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.6"/>`;
}

function motifGap(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  out.push(`<rect x="180" y="380" width="220" height="320" fill="none" stroke="${accent}" stroke-width="2" opacity="0.45"/>`);
  out.push(`<rect x="1200" y="380" width="220" height="320" fill="none" stroke="${accent}" stroke-width="2" opacity="0.45"/>`);
  for (let i = 1; i < 4; i += 1) {
    const y = 380 + i * 80;
    out.push(`<line x1="180" y1="${y}" x2="400" y2="${y}" stroke="${accent}" stroke-width="1" opacity="0.3"/>`);
    out.push(`<line x1="1200" y1="${y}" x2="1420" y2="${y}" stroke="${accent}" stroke-width="1" opacity="0.3"/>`);
  }
  out.push(`<line x1="400" y1="450" x2="1200" y2="450" stroke="${accent}" stroke-width="2" stroke-dasharray="20 12" opacity="0.55" filter="url(#glow)"/>`);
  out.push(`<line x1="400" y1="510" x2="1200" y2="510" stroke="${accent2}" stroke-width="1" stroke-dasharray="6 18" opacity="0.4"/>`);
  for (let i = 0; i < 14; i += 1) {
    const cx = randInt(rng, 560, 1040);
    const cy = randInt(rng, 540, 760);
    const s = randInt(rng, 4, 14);
    const op = randFloat(rng, 0.2, 0.65).toFixed(2);
    const rot = randInt(rng, 0, 45);
    out.push(`<rect x="${cx}" y="${cy}" width="${s}" height="${s}" fill="${accent}" opacity="${op}" transform="rotate(${rot} ${cx + s / 2} ${cy + s / 2})"/>`);
  }
  out.push(`<circle cx="290" cy="300" r="6" fill="${accent}" filter="url(#glow)"/>`);
  out.push(`<circle cx="1310" cy="300" r="6" fill="${accent2}" filter="url(#glow)"/>`);
  return out.join('\n');
}

function motifBlocks(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const y = 200 + i * 38;
    const w = randInt(rng, 100, 380);
    const op = (0.2 + (i % 3) * 0.15).toFixed(2);
    out.push(`<rect x="200" y="${y}" width="${w}" height="6" fill="${accent}" opacity="${op}"/>`);
  }
  out.push(`<path d="M 700 450 L 880 450" stroke="${accent}" stroke-width="2" opacity="0.5"/>`);
  out.push(`<path d="M 870 440 L 880 450 L 870 460" stroke="${accent}" stroke-width="2" fill="none" opacity="0.6"/>`);
  for (let i = 0; i < 5; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const x = 950 + j * 150;
      const y = 280 + i * 80;
      const op = (0.3 + ((i + j) % 3) * 0.15).toFixed(2);
      out.push(`<rect x="${x}" y="${y}" width="120" height="60" fill="none" stroke="${accent2}" stroke-width="1.5" opacity="${op}"/>`);
    }
  }
  out.push(`<rect x="950" y="280" width="120" height="60" fill="${accent}" opacity="0.18"/>`);
  out.push(`<rect x="1250" y="600" width="120" height="60" fill="${accent}" opacity="0.18"/>`);
  return out.join('\n');
}

function motifFlow(accent: string, accent2: string, _rng: () => number): string {
  const out: string[] = [];
  const nodes: Array<[number, number]> = [
    [220, 450],
    [480, 350],
    [740, 450],
    [1000, 350],
    [1260, 450],
    [1380, 600],
  ];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const [x1, y1] = nodes[i];
    const [x2, y2] = nodes[i + 1];
    const cx1 = (x1 + x2) / 2;
    const cy1 = y1;
    const cx2 = (x1 + x2) / 2;
    const cy2 = y2;
    out.push(`<path d="M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}" stroke="${accent2}" stroke-width="2" fill="none" opacity="0.55"/>`);
  }
  nodes.forEach(([cx, cy], i) => {
    const r = 38;
    const pts: string[] = [];
    for (let k = 0; k < 6; k += 1) {
      const ang = ((60 * k - 30) * Math.PI) / 180;
      pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`);
    }
    const op = i % 2 === 0 && i !== 5 ? 0.85 : 0.55;
    out.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${accent}" stroke-width="2.5" opacity="${op}" filter="url(#glow)"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${accent}" opacity="${(op + 0.1).toFixed(2)}"/>`);
  });
  out.push(`<circle cx="800" cy="180" r="100" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="4 8" opacity="0.2"/>`);
  out.push(`<circle cx="800" cy="180" r="60" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="3 6" opacity="0.15"/>`);
  return out.join('\n');
}

function motifLayers(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  const cx = 800;
  const cy = 470;
  const radii = [360, 290, 220, 150, 80];
  radii.forEach((r, i) => {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="1.5" opacity="${(0.2 + i * 0.12).toFixed(2)}"/>`);
  });
  for (let i = 0; i < 12; i += 1) {
    const ang = (i * 30 * Math.PI) / 180;
    const x1 = cx + 80 * Math.cos(ang);
    const y1 = cy + 80 * Math.sin(ang);
    const x2 = cx + 360 * Math.cos(ang);
    const y2 = cy + 360 * Math.sin(ang);
    const op = i % 2 ? 0.18 : 0.35;
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${accent2}" stroke-width="0.8" opacity="${op}"/>`);
  }
  out.push(`<circle cx="${cx}" cy="${cy}" r="18" fill="${accent}" filter="url(#glow)"/>`);
  for (let i = 0; i < 6; i += 1) {
    const ang = randFloat(rng, 0, 2 * Math.PI);
    const x = cx + 360 * Math.cos(ang);
    const y = cy + 360 * Math.sin(ang);
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${BASE_BG}" stroke="${accent}" stroke-width="1.5" opacity="0.7"/>`);
  }
  return out.join('\n');
}

function motifMesh(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  const nodes: Array<[number, number]> = [];
  const cols = 9;
  const rows = 5;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let x = 200 + c * 150 + (r % 2 ? 50 : 0);
      let y = 220 + r * 130;
      x += randInt(rng, -12, 12);
      y += randInt(rng, -8, 8);
      nodes.push([x, y]);
    }
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const [x1, y1] = nodes[i];
      const [x2, y2] = nodes[j];
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 200) {
        const op = Math.max(0.06, 0.4 - d / 600);
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${accent2}" stroke-width="0.8" opacity="${op.toFixed(2)}"/>`);
      }
    }
  }
  nodes.forEach(([x, y], i) => {
    const r = i % 7 ? 6 : 10;
    const op = i % 3 ? 0.45 : 0.85;
    out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${accent}" opacity="${op}" filter="url(#glow)"/>`);
  });
  return out.join('\n');
}

function motifHarness(accent: string, accent2: string, _rng: () => number): string {
  const out: string[] = [];
  const cx = 800;
  const cy = 450;
  out.push(`<circle cx="${cx}" cy="${cy}" r="40" fill="${accent}" opacity="0.85" filter="url(#glow)"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="60" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.6"/>`);
  const layers: Array<[number, number]> = [
    [280, 180],
    [420, 280],
    [600, 400],
    [820, 540],
  ];
  layers.forEach(([w, h], i) => {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const op = (0.55 - i * 0.1).toFixed(2);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${accent2}" stroke-width="2" opacity="${op}" rx="8"/>`);
  });
  const outerX = cx - 410;
  const outerY = cy - 270;
  for (let k = 0; k < 8; k += 1) {
    let x: number;
    let y: number;
    if (k < 4) {
      x = outerX + 20 + (k * (820 - 40)) / 3;
      y = outerY - 6;
    } else {
      x = outerX + 20 + ((k - 4) * (820 - 40)) / 3;
      y = outerY + 540 - 6;
    }
    out.push(`<rect x="${x}" y="${y}" width="40" height="12" fill="${accent}" opacity="0.55" rx="3"/>`);
  }
  for (let k = 0; k < 4; k += 1) {
    const y = outerY + 60 + k * 130;
    out.push(`<rect x="${outerX - 10}" y="${y}" width="14" height="40" fill="${accent2}" opacity="0.4" rx="3"/>`);
    out.push(`<rect x="${outerX + 820 - 4}" y="${y}" width="14" height="40" fill="${accent2}" opacity="0.4" rx="3"/>`);
  }
  return out.join('\n');
}

function motifFragments(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const x = randInt(rng, 120, 1480);
    const y = randInt(rng, 150, 750);
    const w = randInt(rng, 40, 140);
    const h = randInt(rng, 20, 80);
    const rot = randInt(rng, -25, 25);
    const op = randFloat(rng, 0.15, 0.55).toFixed(2);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${accent}" stroke-width="1.5" opacity="${op}" transform="rotate(${rot} ${x + w / 2} ${y + h / 2})" rx="3"/>`);
  }
  for (let i = 0; i < 8; i += 1) {
    const x = randInt(rng, 120, 1400);
    const y = randInt(rng, 150, 750);
    const w = randInt(rng, 60, 120);
    const h = randInt(rng, 40, 70);
    const rot = randInt(rng, -15, 15);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${accent2}" opacity="0.18" transform="rotate(${rot} ${x + w / 2} ${y + h / 2})" rx="3"/>`);
  }
  out.push(`<polyline points="200,460 480,420 720,500 980,440 1280,490 1440,440" stroke="${accent}" stroke-width="2" fill="none" opacity="0.55" filter="url(#glow)"/>`);
  return out.join('\n');
}

function motifAscend(accent: string, accent2: string, _rng: () => number): string {
  const out: string[] = [];
  out.push(`<rect x="180" y="640" width="80" height="80" fill="none" stroke="${accent}" stroke-width="2" opacity="0.85" rx="4"/>`);
  const stages: Array<[number, number, number]> = [
    [320, 540, 140],
    [520, 420, 220],
    [780, 280, 320],
    [1140, 140, 420],
  ];
  stages.forEach(([x, y, s]) => {
    const op = (0.6 - (s / 600) * 0.3).toFixed(2);
    out.push(`<rect x="${x}" y="${y}" width="${s}" height="${Math.round(s * 0.7)}" fill="none" stroke="${accent2}" stroke-width="1.5" opacity="${op}" rx="6"/>`);
    for (let i = 1; i < 4; i += 1) {
      const sx = Math.round(x + (i * s) / 4);
      out.push(`<line x1="${sx}" y1="${y}" x2="${sx}" y2="${Math.round(y + s * 0.7)}" stroke="${accent}" stroke-width="0.6" opacity="0.25"/>`);
    }
  });
  out.push(`<polyline points="220,640 380,540 620,420 920,280 1340,140" stroke="${accent}" stroke-width="2.5" fill="none" opacity="0.7" filter="url(#glow)"/>`);
  for (let i = 0; i < 8; i += 1) {
    const ax = 240 + i * 160;
    const ay = 720 - i * 70;
    out.push(`<circle cx="${ax}" cy="${ay}" r="3" fill="${accent}" opacity="0.5"/>`);
  }
  return out.join('\n');
}

function motifPipeline(accent: string, accent2: string, rng: () => number): string {
  const out: string[] = [];
  for (let row = 0; row < 3; row += 1) {
    const y = 280 + row * 180;
    out.push(`<line x1="180" y1="${y}" x2="1420" y2="${y}" stroke="${accent2}" stroke-width="2" opacity="0.5"/>`);
    for (let k = 0; k < 6; k += 1) {
      const x = 220 + k * 240;
      const op = (0.55 + (k % 3) * 0.15).toFixed(2);
      out.push(`<circle cx="${x}" cy="${y}" r="12" fill="${accent}" opacity="${op}"/>`);
      out.push(`<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="${accent}" stroke-width="1" opacity="0.3"/>`);
    }
    for (let i = 0; i < 8; i += 1) {
      const tx = randInt(rng, 200, 1420);
      const op = randFloat(rng, 0.4, 0.8).toFixed(2);
      out.push(`<rect x="${tx}" y="${y - 4}" width="3" height="8" fill="${accent}" opacity="${op}"/>`);
    }
  }
  out.push(`<line x1="460" y1="280" x2="460" y2="640" stroke="${accent}" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.45"/>`);
  out.push(`<line x1="940" y1="280" x2="940" y2="640" stroke="${accent}" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.45"/>`);
  out.push(`<line x1="1180" y1="460" x2="1180" y2="640" stroke="${accent}" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.45"/>`);
  return out.join('\n');
}

function motifHorizon(accent: string, accent2: string, _rng: () => number): string {
  const out: string[] = [];
  const cx = 800;
  const cy = 520;
  out.push(`<line x1="100" y1="${cy}" x2="1500" y2="${cy}" stroke="${accent}" stroke-width="1.5" opacity="0.6"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="80" fill="none" stroke="${accent}" stroke-width="2" opacity="0.7" filter="url(#glow)"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="40" fill="${accent}" opacity="0.55" filter="url(#glow)"/>`);
  for (let k = 0; k < 7; k += 1) {
    const offset = (k - 3) * 160;
    const xNear = cx + offset * 4.5;
    const op = (0.3 - Math.abs(k - 3) * 0.04).toFixed(2);
    out.push(`<line x1="${Math.round(xNear)}" y1="880" x2="${cx}" y2="${cy}" stroke="${accent2}" stroke-width="1" opacity="${op}"/>`);
  }
  for (let k = 1; k < 10; k += 1) {
    const scale = k / 10;
    const xLeft = cx - 700 * (1 - scale);
    const xRight = cx + 700 * (1 - scale);
    const ty = cy + 360 * (1 - scale);
    if (ty < cy) continue;
    const op = (0.18 + scale * 0.3).toFixed(2);
    out.push(`<line x1="${Math.round(xLeft)}" y1="${Math.round(ty)}" x2="${Math.round(xRight)}" y2="${Math.round(ty)}" stroke="${accent}" stroke-width="0.8" opacity="${op}"/>`);
  }
  const peaks: Array<[number, number]> = [
    [220, 420],
    [380, 460],
    [1180, 450],
    [1340, 440],
    [1480, 470],
  ];
  peaks.forEach(([px, py]) => {
    out.push(`<polygon points="${px - 30},${cy} ${px},${py} ${px + 30},${cy}" fill="none" stroke="${accent2}" stroke-width="1.2" opacity="0.55"/>`);
  });
  return out.join('\n');
}

const MOTIF_FNS: Record<Motif, (accent: string, accent2: string, rng: () => number) => string> = {
  gap: motifGap,
  blocks: motifBlocks,
  flow: motifFlow,
  layers: motifLayers,
  mesh: motifMesh,
  harness: motifHarness,
  fragments: motifFragments,
  ascend: motifAscend,
  pipeline: motifPipeline,
  horizon: motifHorizon,
};

function overlayNoise(rng: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 180; i += 1) {
    const x = randInt(rng, 0, W);
    const y = randInt(rng, 0, H);
    const r = randFloat(rng, 0.4, 1.4).toFixed(1);
    const op = randFloat(rng, 0.08, 0.25).toFixed(2);
    out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${op}"/>`);
  }
  return out.join('\n');
}

function isValidMotif(m: string): m is Motif {
  return (MOTIFS as ReadonlyArray<string>).includes(m);
}

function isValidHexColor(c: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(c);
}

export interface CoverParams {
  slug: string;
  motif: Motif | string;
  accent?: string;
  accent2?: string;
}

/**
 * Build the SVG string for a post cover. Falls back to deterministic motif/accent
 * picks based on the slug when inputs are invalid, so a misbehaving LLM can't
 * break generation.
 */
export function buildCoverSvg(params: CoverParams): string {
  const rng = makeRng(params.slug);
  const motif: Motif = isValidMotif(params.motif) ? params.motif : MOTIFS[Math.floor(rng() * MOTIFS.length)];
  const accentPick = ACCENTS[Math.floor(rng() * ACCENTS.length)];
  const accent = params.accent && isValidHexColor(params.accent) ? params.accent : accentPick.accent;
  const accent2 = params.accent2 && isValidHexColor(params.accent2) ? params.accent2 : accentPick.accent2;

  const motifSvg = MOTIF_FNS[motif](accent, accent2, rng);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
${defs(accent, accent2)}
${background()}
${motifSvg}
${overlayNoise(rng)}
</svg>`;
}

export function writeCover(outputPath: string, params: CoverParams): void {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, buildCoverSvg(params), 'utf-8');
}
