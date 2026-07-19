import { z } from 'zod';

/**
 * World events with causal metadata (DESIGN §5.2).
 * Causality is recorded at emission time: it is the substrate for
 * consequence receipts, story sifters, the chronicle, and legends.
 */
export const GameEventSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  tick: z.number().int(),
  revision: z.number().int(),
  verb: z.string(),
  actorId: z.string().nullable(),
  targetIds: z.array(z.string()),
  /** Verb-specific payload (e.g. talk -> { agentName, displayName }). */
  data: z.record(z.unknown()).default({}),
  /** Event/action ids that caused this event. */
  causedBy: z.array(z.string()).default([]),
  /** Entities whose field of view contained the event location. */
  witnessedBy: z.array(z.string()).default([]),
  narrativeTags: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

/** Client-facing projection of an event (no causal internals). */
export const GameEventViewSchema = z.object({
  id: z.string(),
  tick: z.number().int(),
  verb: z.string(),
  actorId: z.string().nullable(),
  targetIds: z.array(z.string()),
  data: z.record(z.unknown()).default({}),
});
export type GameEventView = z.infer<typeof GameEventViewSchema>;
