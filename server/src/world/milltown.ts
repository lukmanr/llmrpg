import { NPC_PLACEHOLDER_AGENT, type EntityKind, type Terrain } from '@llmrpg/shared';
import type { ComponentData, ComponentKind } from '../engine/components';

/**
 * Handcrafted Milltown locale (~44×24).
 *
 * Legend:
 *   # wall    T tree    . floor    , grass
 *   = road    ~ water   + door
 *   G player start (road)   B Bram (road)   N noticeboard marker (floor)
 *
 * Layout: outer wall/tree ring, south gate on a road leading to a central
 * cobbled square, mill (NW, walls + structure entity), pond (NE), two houses
 * with doors, noticeboard by the square.
 */

export const MILLTOWN_WORLD_ID = 'milltown';

export const MILLTOWN_ASCII = `
############################################
#TTTT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,TTTTTTTT#
#T,,,........,,,,,,,,,,,,,,,,,,,,,,,...,,,T#
#T,,..######..,,,,,,,,,,,,,,,,,,,,,~.~,,,,T#
#T,,..#....#..,,,,,,,,,,,,,,,,,,,~~~~~,,,,T#
#T,,..#....+..,,,,,,,,,,,,,,,,,,,,,~.~,,,,T#
#T,,..######..,,,,,,,,,,,,,,,,,,,,,,.,,,,,T#
#T,,,,,,,,,,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.....=......,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.====.====.,,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.=........=.,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.=...N....=.,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.=........=.,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.==========.,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,.....=......,,,,,,,,,,,,,,,,,,,T#
#T,,,,######,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,#....#,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,#....+,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,#....#,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,######,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,T#
#T,,,,,,,,,,,,,,=,,,,,,,,,,,,,,,,,,,,,,,,,T#
#TTTT,,,,,,,,,,,B,,,,,,,,,,,,,,,,,,,,TTTTTT#
#TTTT===========G====================TTTTTT#
############################################
`.trim();

const CHAR_TO_TERRAIN: Record<string, Terrain> = {
  '#': 'wall',
  T: 'tree',
  '.': 'floor',
  ',': 'grass',
  '=': 'road',
  '~': 'water',
  '+': 'door',
  G: 'road',
  B: 'road',
  N: 'floor',
};

export interface SpawnSpec {
  id: string;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  components: Partial<{ [K in ComponentKind]: ComponentData[K] }>;
}

export interface MilltownLocale {
  width: number;
  height: number;
  terrain: Terrain[];
  markers: { char: string; x: number; y: number }[];
  spawns: SpawnSpec[];
  playerStart: { x: number; y: number };
}

export function parseMilltown(): MilltownLocale {
  const rows = MILLTOWN_ASCII.split('\n').map((r) => r.trimEnd());
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('Milltown map is empty');
  }
  for (const row of rows) {
    if (row.length !== width) {
      throw new Error(
        `Milltown map row length ${row.length} !== width ${width}: "${row}"`,
      );
    }
  }

  const terrain: Terrain[] = [];
  const markers: { char: string; x: number; y: number }[] = [];
  let playerStart: { x: number; y: number } | undefined;
  let bramPos: { x: number; y: number } | undefined;
  let noticePos: { x: number; y: number } | undefined;

  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) {
      const ch = row[x]!;
      const t = CHAR_TO_TERRAIN[ch];
      if (!t) {
        throw new Error(`Unknown Milltown char '${ch}' at ${x},${y}`);
      }
      terrain.push(t);
      if (ch === 'G' || ch === 'B' || ch === 'N') {
        markers.push({ char: ch, x, y });
      }
      if (ch === 'G') playerStart = { x, y };
      else if (ch === 'B') bramPos = { x, y };
      else if (ch === 'N') noticePos = { x, y };
    }
  }

  if (!playerStart) throw new Error('Milltown map missing player start (G)');
  if (!bramPos) throw new Error('Milltown map missing Bram (B)');
  if (!noticePos) throw new Error('Milltown map missing noticeboard (N)');

  // Mill structure on an interior floor tile of the NW building.
  const millPos = { x: 8, y: 4 };
  // Cat near the pond (static — does not wander in Phase 1).
  const catPos = { x: 32, y: 6 };
  // Ground items on the cobbled square (not on the noticeboard tile).
  const coinPos = { x: 14, y: 10 };
  const breadPos = { x: 15, y: 12 };
  const lanternPos = { x: 18, y: 10 };

  const spawns: SpawnSpec[] = [
    {
      id: 'npc_bram',
      kind: 'npc',
      name: 'Bram the Gatekeeper',
      x: bramPos.x,
      y: bramPos.y,
      components: {
        Position: { x: bramPos.x, y: bramPos.y },
        Appearance: { archetype: 'gatekeeper', tags: ['npc'] },
        Health: { hp: 10, maxHp: 10 },
        Inventory: { itemIds: [] },
        Blocker: {},
        Talkable: { agentName: NPC_PLACEHOLDER_AGENT },
      },
    },
    {
      id: 'creature_cat',
      kind: 'creature',
      name: 'a stray cat',
      x: catPos.x,
      y: catPos.y,
      components: {
        Position: { x: catPos.x, y: catPos.y },
        Appearance: { archetype: 'cat', tags: ['creature'] },
        Health: { hp: 3, maxHp: 3 },
        Blocker: {},
      },
    },
    {
      id: 'struct_mill',
      kind: 'structure',
      name: 'the old mill',
      x: millPos.x,
      y: millPos.y,
      components: {
        Position: { x: millPos.x, y: millPos.y },
        Appearance: { archetype: 'mill', tags: ['structure'] },
        Blocker: {},
      },
    },
    {
      id: 'struct_noticeboard',
      kind: 'structure',
      name: 'a weathered noticeboard',
      x: noticePos.x,
      y: noticePos.y,
      components: {
        Position: { x: noticePos.x, y: noticePos.y },
        Appearance: { archetype: 'noticeboard', tags: ['structure'] },
        Blocker: {},
      },
    },
    {
      id: 'item_copper_coin',
      kind: 'item',
      name: 'copper coin',
      x: coinPos.x,
      y: coinPos.y,
      components: {
        Position: { x: coinPos.x, y: coinPos.y },
        Appearance: { archetype: 'coin', tags: ['item'] },
        Item: { kind: 'coin', carryable: true },
      },
    },
    {
      id: 'item_bread',
      kind: 'item',
      name: 'bread loaf',
      x: breadPos.x,
      y: breadPos.y,
      components: {
        Position: { x: breadPos.x, y: breadPos.y },
        Appearance: { archetype: 'bread', tags: ['item'] },
        Item: { kind: 'bread', carryable: true },
      },
    },
    {
      id: 'item_lantern',
      kind: 'item',
      name: 'lantern',
      x: lanternPos.x,
      y: lanternPos.y,
      components: {
        Position: { x: lanternPos.x, y: lanternPos.y },
        Appearance: { archetype: 'lantern', tags: ['item'] },
        Item: { kind: 'lantern', carryable: true },
      },
    },
  ];

  return {
    width,
    height,
    terrain,
    markers,
    spawns,
    playerStart,
  };
}
