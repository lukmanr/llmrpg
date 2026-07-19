import type { Appearance, EntityView, Terrain } from '@llmrpg/shared';
import type { AppearanceMapper } from '@llmrpg/eal-core';

/** Entity presentation for the tile renderer. */
export interface TileVisual {
  emoji?: string;
  /** CSS color for a ring painted under the emoji (player). */
  ring?: string;
  opacity?: number;
}

export type TerrainVisibility = 'visible' | 'explored' | 'unexplored';

/** Storybook parchment palette shared with the client shell. */
export const PALETTE = {
  ink: '#2b2417',
  parchment: '#f5efe2',
  panel: '#fffdf7',
  accentAmber: '#b45f06',
  accentTeal: '#0f766e',
  /** Canvas / unexplored fill. */
  bg: '#efe8d8',
  mist: '#efe8d8',
  grass: '#a8c686',
  road: '#d9c49a',
  floor: '#e8dcc0',
  wall: '#9a8f7c',
  wallBorder: '#7a7060',
  water: '#8ec5e8',
  waterWave: '#b8dbf0',
  door: '#b07d4f',
  doorFrame: '#8a5f38',
  hover: 'rgba(180, 95, 6, 0.55)',
  grid: 'rgba(0, 0, 0, 0.04)',
} as const;

const TERRAIN_FILL: Record<Terrain, string> = {
  grass: PALETTE.grass,
  road: PALETTE.road,
  floor: PALETTE.floor,
  wall: PALETTE.wall,
  water: PALETTE.water,
  door: PALETTE.door,
  tree: PALETTE.grass,
};

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix `hex` toward `toward` by `t` (0 = hex, 1 = toward). */
export function mixToward(hex: string, toward: string, t: number): string {
  const [r1, g1, b1] = parseHex(hex);
  const [r2, g2, b2] = parseHex(toward);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function darker(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function fillForState(base: string, state: TerrainVisibility): string {
  if (state === 'visible') return base;
  if (state === 'explored') return mixToward(base, PALETTE.mist, 0.55);
  return PALETTE.mist;
}

/**
 * Paint one terrain cell. Coordinates are canvas CSS pixels (top-left of cell).
 * Tree emoji is drawn here; entity emojis are drawn by the renderer.
 */
export function paintTerrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  terrain: Terrain | null,
  state: TerrainVisibility,
): void {
  if (state === 'unexplored' || terrain == null) {
    ctx.fillStyle = PALETTE.mist;
    ctx.fillRect(x, y, cell, cell);
    return;
  }

  const fill = fillForState(TERRAIN_FILL[terrain], state);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, cell, cell);

  // Subtle 2-tone checker for soft texture on open ground.
  if (terrain === 'grass' || terrain === 'road' || terrain === 'floor') {
    const alt = darker(fill, 0.06);
    ctx.fillStyle = alt;
    const half = cell / 2;
    ctx.fillRect(x, y, half, half);
    ctx.fillRect(x + half, y + half, half, half);
  }

  // 1px darker inner border.
  ctx.strokeStyle = darker(fill, 0.12);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

  if (terrain === 'wall') {
    const border = state === 'visible' ? PALETTE.wallBorder : mixToward(PALETTE.wallBorder, PALETTE.mist, 0.55);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    // Slight 3D top edge highlight.
    ctx.fillStyle = state === 'visible' ? mixToward(fill, '#ffffff', 0.25) : mixToward(fill, PALETTE.mist, 0.2);
    ctx.fillRect(x + 2, y + 2, cell - 4, Math.max(2, cell * 0.12));
  }

  if (terrain === 'water') {
    const wave = state === 'visible' ? PALETTE.waterWave : mixToward(PALETTE.waterWave, PALETTE.mist, 0.55);
    ctx.strokeStyle = wave;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const midY = y + cell * 0.38;
    ctx.moveTo(x + 3, midY);
    ctx.quadraticCurveTo(x + cell * 0.35, midY - 3, x + cell * 0.55, midY);
    ctx.quadraticCurveTo(x + cell * 0.75, midY + 3, x + cell - 3, midY);
    ctx.stroke();
    ctx.beginPath();
    const midY2 = y + cell * 0.62;
    ctx.moveTo(x + 4, midY2);
    ctx.quadraticCurveTo(x + cell * 0.4, midY2 + 3, x + cell * 0.6, midY2);
    ctx.quadraticCurveTo(x + cell * 0.8, midY2 - 2, x + cell - 4, midY2);
    ctx.stroke();
  }

  if (terrain === 'door') {
    const frame = state === 'visible' ? PALETTE.doorFrame : mixToward(PALETTE.doorFrame, PALETTE.mist, 0.55);
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
  }

  if (terrain === 'tree') {
    const fontPx = Math.floor(cell * 0.78);
    ctx.save();
    ctx.globalAlpha = state === 'explored' ? 0.65 : 1;
    ctx.font = `${fontPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌳', x + cell / 2, y + cell / 2);
    ctx.restore();
  }
}

const ARCHETYPE_VISUAL: Record<string, TileVisual> = {
  player: { emoji: '🧑‍🦱', ring: PALETTE.accentAmber },
  gatekeeper: { emoji: '💂' },
  baker: { emoji: '👩‍🍳' },
  miller: { emoji: '🧑‍🌾' },
  apprentice: { emoji: '🧑‍🔧' },
  innkeeper: { emoji: '👩‍🦰' },
  farmhand: { emoji: '👨‍🌾' },
  priest: { emoji: '👴' },
  smith: { emoji: '🧑‍🏭' },
  beggar: { emoji: '🧓' },
  cat: { emoji: '🐈' },
  coin: { emoji: '🪙' },
  bread: { emoji: '🍞' },
  lantern: { emoji: '🏮' },
  noticeboard: { emoji: '📜' },
  mill: { emoji: '⚙️' },
};

const KIND_FALLBACK: Record<EntityView['kind'], TileVisual> = {
  player: { emoji: '🧑‍🦱', ring: PALETTE.accentAmber },
  npc: { emoji: '🧑' },
  item: { emoji: '✨' },
  structure: { emoji: '🏠' },
  creature: { emoji: '🐾' },
};

export class TileAppearanceMapper implements AppearanceMapper<TileVisual> {
  terrain(_terrain: Terrain, _explored: boolean): TileVisual {
    // Terrain is painted via paintTerrain; no emoji overlay from the mapper.
    return {};
  }

  entity(appearance: Appearance, kind: EntityView['kind']): TileVisual {
    const byArchetype = ARCHETYPE_VISUAL[appearance.archetype];
    if (byArchetype) return { ...byArchetype };
    return { ...KIND_FALLBACK[kind] };
  }
}

export const defaultAppearanceMapper = new TileAppearanceMapper();
