import type { Appearance } from '@llmrpg/shared';
import { z } from 'zod';

export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type Position = z.infer<typeof PositionSchema>;

/** Local parse schema — shared AppearanceSchema input allows omitted tags. */
export const AppearanceComponentSchema = z.object({
  archetype: z.string(),
  tags: z.array(z.string()),
});

export const HealthSchema = z.object({
  hp: z.number().int(),
  maxHp: z.number().int(),
});
export type Health = z.infer<typeof HealthSchema>;

export const InventorySchema = z.object({
  itemIds: z.array(z.string()),
});
export type Inventory = z.infer<typeof InventorySchema>;

export const ItemSchema = z.object({
  kind: z.string(),
  carryable: z.boolean(),
});
export type Item = z.infer<typeof ItemSchema>;

export const BlockerSchema = z.object({}).strict();
export type Blocker = z.infer<typeof BlockerSchema>;

export const TalkableSchema = z.object({
  agentName: z.string(),
});
export type Talkable = z.infer<typeof TalkableSchema>;

export const DeadSchema = z.object({}).strict();
export type Dead = z.infer<typeof DeadSchema>;

export const COMPONENT_KINDS = [
  'Position',
  'Appearance',
  'Health',
  'Inventory',
  'Item',
  'Blocker',
  'Talkable',
  'Dead',
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export type ComponentData = {
  Position: Position;
  Appearance: Appearance;
  Health: Health;
  Inventory: Inventory;
  Item: Item;
  Blocker: Blocker;
  Talkable: Talkable;
  Dead: Dead;
};

const SCHEMAS: { [K in ComponentKind]: z.ZodType<ComponentData[K]> } = {
  Position: PositionSchema,
  Appearance: AppearanceComponentSchema,
  Health: HealthSchema,
  Inventory: InventorySchema,
  Item: ItemSchema,
  Blocker: BlockerSchema,
  Talkable: TalkableSchema,
  Dead: DeadSchema,
};

export function serializeComponent<K extends ComponentKind>(
  kind: K,
  data: ComponentData[K],
): string {
  return JSON.stringify(SCHEMAS[kind].parse(data));
}

export function deserializeComponent<K extends ComponentKind>(
  kind: K,
  raw: string,
): ComponentData[K] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON for component ${kind}`);
  }
  return SCHEMAS[kind].parse(parsed);
}

export function isComponentKind(value: string): value is ComponentKind {
  return (COMPONENT_KINDS as readonly string[]).includes(value);
}
