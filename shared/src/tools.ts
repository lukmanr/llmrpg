import { z } from 'zod';
import { ActingContextSchema, ACTING_CONTEXT_KEY } from './agent-context.js';

/**
 * Phase 0 hello-world tool: `world_look`.
 * The placeholder NPC uses it to "look around" its (stub) surroundings,
 * proving the SkillShop -> llmrpg tool callback path end to end.
 */
export const WORLD_LOOK_TOOL = 'world_look' as const;

export const WorldLookInputSchema = z.object({
  target: z
    .string()
    .optional()
    .describe('What to look at; omit for general surroundings'),
  [ACTING_CONTEXT_KEY]: ActingContextSchema.optional(),
});
export type WorldLookInput = z.infer<typeof WorldLookInputSchema>;

export const WorldLookResultSchema = z.object({
  description: z.string(),
  entities: z.array(
    z.object({ id: z.string(), type: z.string(), name: z.string() }),
  ),
});
export type WorldLookResult = z.infer<typeof WorldLookResultSchema>;

/** Phase 0 placeholder NPC agent registered in SkillShop. */
export const NPC_PLACEHOLDER_AGENT = 'llmrpg_npc_placeholder' as const;
