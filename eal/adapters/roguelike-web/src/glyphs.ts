import type { Appearance, EntityView, Terrain } from '@llmrpg/shared';
import type { AppearanceMapper } from '@llmrpg/eal-core';

export interface Glyph {
  char: string;
  fg: string;
  bg?: string;
}

/** Named palette used by the R1 glyph mapper. */
export const PALETTE = {
  wall: '#6e6e6e',
  floor: '#5a5348',
  road: '#8a7355',
  grass: '#4a7a4a',
  water: '#3a6ea5',
  door: '#8b5a2b',
  tree: '#3d8b4a',
  player: '#d4a24c',
  gatekeeper: '#b87333',
  cat: '#e8e4dc',
  coin: '#e6c35c',
  bread: '#c4a574',
  lantern: '#e8c84a',
  noticeboard: '#8b6914',
  mill: '#8a8a8a',
  npc: '#c9a87c',
  item: '#c9b896',
  structure: '#9a9588',
  creature: '#c45c4a',
  unknown: '#6e5c3e',
  bg: '#0c0b09',
} as const;

const EXPLORED_BRIGHTNESS = 0.35;

function dimColor(hex: string, factor: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const r = Math.round(parseInt(raw.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(raw.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(raw.slice(4, 6), 16) * factor);
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const TERRAIN_GLYPHS: Record<Terrain, Glyph> = {
  wall: { char: '#', fg: PALETTE.wall },
  floor: { char: '.', fg: PALETTE.floor },
  road: { char: '░', fg: PALETTE.road },
  grass: { char: '"', fg: PALETTE.grass },
  water: { char: '~', fg: PALETTE.water },
  door: { char: '+', fg: PALETTE.door },
  tree: { char: '♣', fg: PALETTE.tree },
};

const ARCHETYPE_GLYPHS: Record<string, Glyph> = {
  player: { char: '@', fg: PALETTE.player },
  gatekeeper: { char: 'B', fg: PALETTE.gatekeeper },
  cat: { char: 'c', fg: PALETTE.cat },
  coin: { char: '$', fg: PALETTE.coin },
  bread: { char: '%', fg: PALETTE.bread },
  lantern: { char: '(', fg: PALETTE.lantern },
  noticeboard: { char: '?', fg: PALETTE.noticeboard },
  mill: { char: 'M', fg: PALETTE.mill },
};

const KIND_FALLBACK: Record<EntityView['kind'], Glyph> = {
  player: { char: '@', fg: PALETTE.player },
  npc: { char: 'p', fg: PALETTE.npc },
  item: { char: '*', fg: PALETTE.item },
  structure: { char: '□', fg: PALETTE.structure },
  creature: { char: 'x', fg: PALETTE.creature },
};

export class GlyphAppearanceMapper implements AppearanceMapper<Glyph> {
  terrain(terrain: Terrain, explored: boolean): Glyph {
    const base = TERRAIN_GLYPHS[terrain];
    if (explored) {
      return { char: base.char, fg: dimColor(base.fg, EXPLORED_BRIGHTNESS), bg: base.bg };
    }
    return { ...base };
  }

  entity(appearance: Appearance, kind: EntityView['kind']): Glyph {
    const byArchetype = ARCHETYPE_GLYPHS[appearance.archetype];
    if (byArchetype) return { ...byArchetype };
    return { ...KIND_FALLBACK[kind] };
  }
}

export const defaultAppearanceMapper = new GlyphAppearanceMapper();
