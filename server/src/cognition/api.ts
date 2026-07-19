import type {
  ClaimView,
  DialogueState,
  GameEvent,
  Journal,
  PromiseView,
  ReceiptView,
} from '@llmrpg/shared';

/**
 * Cognition store interfaces (Phase 2 spine).
 *
 * Implemented in server/src/cognition/* against the world DB; the dialogue
 * orchestrator, NPC tools, and journal routes are coded against these
 * interfaces. Keep them narrow: they are the seam between the cognition
 * subsystem and everything else.
 */

export interface MemoryRecord {
  id: string;
  npcId: string;
  tick: number;
  type: 'observation' | 'thought' | 'belief' | 'promise' | 'reflection' | 'dialogue';
  text: string;
  /** Entity ids this memory is about. */
  subjects: string[];
  /** 0..10 poignancy. */
  importance: number;
  createdAt: string;
}

export interface BeliefRecord {
  id: string;
  npcId: string;
  proposition: string;
  aboutEntityIds: string[];
  /** Entity id of who they learned it from, or event id if firsthand. */
  source: string;
  firsthand: boolean;
  /** 0..1 */
  confidence: number;
  observedAtTick: number;
  receivedAtTick: number;
  /** Hop records: entity ids the belief passed through, oldest first. */
  distortionHistory: string[];
}

export interface RelationshipRecord {
  npcId: string;
  otherId: string;
  /** -100..100 axes. */
  trust: number;
  affection: number;
  fear: number;
  /** Short prose annotation, templated or LLM-written. */
  note: string;
  updatedAtTick: number;
}

export interface MemoryQuery {
  npcId: string;
  /** Free-text query for FTS ranking (optional). */
  text?: string;
  /** Boost/filter memories about these entities. */
  subjects?: string[];
  types?: MemoryRecord['type'][];
  limit?: number;
}

export interface MemoryStore {
  append(record: Omit<MemoryRecord, 'id' | 'createdAt'>): MemoryRecord;
  /** Hybrid retrieval: FTS + subject links + recency + importance (DESIGN §6.3). */
  retrieve(query: MemoryQuery): MemoryRecord[];
  /** Sum of importance since the NPC's last reflection (reflection trigger). */
  importanceSinceReflection(npcId: string): number;
  markReflected(npcId: string): void;
}

export interface BeliefStore {
  upsert(record: Omit<BeliefRecord, 'id'>): BeliefRecord;
  forNpc(npcId: string): BeliefRecord[];
  about(npcId: string, aboutEntityId: string): BeliefRecord[];
  /** Transmit a belief npc->npc with provenance + confidence decay. */
  transmit(fromNpcId: string, toNpcId: string, beliefId: string, atTick: number): BeliefRecord | null;
}

export interface RelationshipStore {
  get(npcId: string, otherId: string): RelationshipRecord | null;
  forNpc(npcId: string): RelationshipRecord[];
  adjust(
    npcId: string,
    otherId: string,
    delta: Partial<Pick<RelationshipRecord, 'trust' | 'affection' | 'fear'>>,
    note: string,
    atTick: number,
  ): RelationshipRecord;
}

export interface PromiseStore {
  create(input: {
    fromEntityId: string;
    toEntityId: string;
    terms: string;
    deadlineTick: number | null;
    atTick: number;
  }): PromiseView;
  open(): PromiseView[];
  /** Deadline sweep + status transitions; returns promises that changed. */
  sweep(atTick: number): PromiseView[];
  resolve(id: string, status: 'kept' | 'broken', atTick: number): PromiseView | null;
}

export interface ClaimStore {
  record(input: Omit<ClaimView, 'id'>): ClaimView;
  all(): ClaimView[];
}

export interface ReceiptStore {
  record(input: { tick: number; text: string; eventIds: string[] }): ReceiptView;
  /** Receipts not yet delivered to the client, marking them delivered. */
  drain(): ReceiptView[];
  all(): ReceiptView[];
}

export interface JobRecord {
  id: string;
  kind: 'reflection' | 'gossip';
  npcId: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  runAfterTick: number;
  lastError: string | null;
}

/** Durable Deliberate-tier outbox (DESIGN §3.2). */
export interface JobQueue {
  enqueue(kind: JobRecord['kind'], npcId: string | null, payload: Record<string, unknown>, runAfterTick: number): JobRecord;
  /** Claim up to n runnable jobs (status pending, runAfterTick <= tick). */
  claim(tick: number, n: number): JobRecord[];
  complete(id: string): void;
  fail(id: string, error: string, retry: boolean): void;
}

export interface VowStore {
  create(text: string, atTick: number): void;
  setStatus(id: string, status: 'kept' | 'broken'): void;
}

export interface ProfileStore {
  getName(): string | null;
  setName(name: string): void;
}

export interface ConversationStore {
  start(npcId: string, npcName: string, patience: number, rapport: number): DialogueState;
  get(dialogueId: string): DialogueState | null;
  update(dialogueId: string, patch: Partial<DialogueState>): DialogueState | null;
  end(dialogueId: string, closingLine?: string): DialogueState | null;
  activeFor(npcId: string): DialogueState | null;
}

export interface CognitionStores {
  memories: MemoryStore;
  beliefs: BeliefStore;
  relationships: RelationshipStore;
  promises: PromiseStore;
  claims: ClaimStore;
  receipts: ReceiptStore;
  jobs: JobQueue;
  conversations: ConversationStore;
  vows: VowStore;
  profile: ProfileStore;
  buildJournal(): Journal;
}

// Turn hooks are defined by the engine: see WorldTurnHook / TurnHookArgs in
// server/src/engine/world.ts. Cognition hooks implement that contract.
