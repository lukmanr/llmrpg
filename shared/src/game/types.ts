import { z } from 'zod';

/** Terrain vocabulary for Phase 1. Flags are derived server-side. */
export const TerrainSchema = z.enum([
  'floor',
  'wall',
  'road',
  'grass',
  'water',
  'door',
  'tree',
]);
export type Terrain = z.infer<typeof TerrainSchema>;

export const TERRAIN_FLAGS: Record<Terrain, { passable: boolean; opaque: boolean }> = {
  floor: { passable: true, opaque: false },
  wall: { passable: false, opaque: true },
  road: { passable: true, opaque: false },
  grass: { passable: true, opaque: false },
  water: { passable: false, opaque: false },
  door: { passable: true, opaque: false },
  tree: { passable: false, opaque: true },
};

/**
 * Appearance descriptor (DESIGN §4.1): game logic never mentions glyphs.
 * The EAL adapter maps archetype/tags to a glyph + color (or a mesh later).
 */
export const AppearanceSchema = z.object({
  archetype: z.string(),
  tags: z.array(z.string()).default([]),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const EntityKindSchema = z.enum(['player', 'npc', 'item', 'structure', 'creature']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/** Client-facing view of a visible entity (flattened components). */
export const EntityViewSchema = z.object({
  id: z.string(),
  kind: EntityKindSchema,
  name: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  appearance: AppearanceSchema,
  blocking: z.boolean(),
  carryable: z.boolean(),
  talkable: z.boolean(),
  hp: z.number().int().optional(),
  maxHp: z.number().int().optional(),
});
export type EntityView = z.infer<typeof EntityViewSchema>;

export const InventoryItemViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type InventoryItemView = z.infer<typeof InventoryItemViewSchema>;

export const PlayerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  inventory: z.array(InventoryItemViewSchema),
});
export type PlayerView = z.infer<typeof PlayerViewSchema>;

export const LogToneSchema = z.enum(['info', 'combat', 'dialogue', 'system']);
export type LogTone = z.infer<typeof LogToneSchema>;

export const LogLineSchema = z.object({
  tick: z.number().int(),
  text: z.string(),
  tone: LogToneSchema,
});
export type LogLine = z.infer<typeof LogLineSchema>;
