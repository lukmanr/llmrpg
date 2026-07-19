import {
  EARSHOT_RADIUS,
  SKILLSHOP_URL,
  gameTime,
  type DialogueAct,
  type DialogueState,
  type DialogueTurnResponse,
} from '@llmrpg/shared';
import type { CognitionStores } from '../cognition/api';
import type { WorldService } from '../engine/world';
import { getComponent } from '../engine/state';
import { registerExecution } from './registry';

/** Patience/rapport dynamics per dialogue act (DESIGN §6.4). */
const ACT_EFFECTS: Record<DialogueAct, { patience: number; rapport: number }> = {
  say: { patience: -4, rapport: 0 },
  ask: { patience: -4, rapport: 0 },
  accuse: { patience: -14, rapport: -6 },
  bargain: { patience: -6, rapport: 0 },
  promise: { patience: -2, rapport: 2 },
  comfort: { patience: 0, rapport: 4 },
  threaten: { patience: -18, rapport: -10 },
  reveal: { patience: -2, rapport: 2 },
  refuse: { patience: -8, rapport: -2 },
  farewell: { patience: 0, rapport: 0 },
};

export interface PersonaProvider {
  fullSheet(entityId: string): string | null;
  summary(entityId: string): string | null;
}

interface TranscriptEntry {
  speaker: 'player' | 'npc';
  act?: DialogueAct;
  text: string;
}

export interface DialogueOrchestratorDeps {
  stores: CognitionStores;
  world: WorldService;
  personas: PersonaProvider;
  playthroughId: string;
  playerEntityId: string;
  agentName?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export class DialogueOrchestrator {
  private readonly transcripts = new Map<string, TranscriptEntry[]>();
  private readonly deps: Required<
    Pick<DialogueOrchestratorDeps, 'agentName' | 'pollIntervalMs' | 'pollTimeoutMs'>
  > &
    DialogueOrchestratorDeps;

  constructor(deps: DialogueOrchestratorDeps) {
    this.deps = {
      agentName: 'llmrpg_npc_actor',
      pollIntervalMs: 1000,
      pollTimeoutMs: 90_000,
      ...deps,
    };
  }

  start(targetId: string, options: { earshot?: boolean } = {}): DialogueState {
    const { stores, world, playerEntityId } = this.deps;
    const state = world.loadWorldState();
    const npc = state.entities.get(targetId);
    if (!npc) throw new DialogueError('not_found', 'No such person.');
    const talkable = getComponent(npc, 'Talkable');
    if (!talkable) throw new DialogueError('invalid', 'They have nothing to say.');
    const npcPos = getComponent(npc, 'Position');
    const playerPos = getComponent(state.entities.get(playerEntityId)!, 'Position');
    if (!npcPos || !playerPos) throw new DialogueError('invalid', 'Nobody is there.');
    // Spontaneous speech carries across a few tiles; face-to-face talk is adjacent.
    const maxDistance = options.earshot ? EARSHOT_RADIUS : 1;
    if (Math.max(Math.abs(npcPos.x - playerPos.x), Math.abs(npcPos.y - playerPos.y)) > maxDistance) {
      throw new DialogueError('out_of_range', 'They are too far away.');
    }

    const existing = stores.conversations.activeFor(targetId);
    if (existing) return existing;

    const rel = stores.relationships.get(targetId, playerEntityId);
    const trust = rel?.trust ?? 0;
    const affection = rel?.affection ?? 0;
    const patience = clamp(50 + affection * 0.3 + trust * 0.2, 20, 90);
    const rapport = clamp((trust + affection) / 2, -100, 100);

    const dialogue = stores.conversations.start(targetId, npc.name, patience, rapport);
    this.transcripts.set(dialogue.dialogueId, []);
    return dialogue;
  }

  getState(dialogueId: string): DialogueState | null {
    return this.deps.stores.conversations.get(dialogueId);
  }

  async turn(dialogueId: string, act: DialogueAct, text: string): Promise<DialogueTurnResponse> {
    const { stores, world, personas, playerEntityId } = this.deps;
    const dialogue = stores.conversations.get(dialogueId);
    if (!dialogue) throw new DialogueError('not_found', 'No such conversation.');
    if (dialogue.ended) throw new DialogueError('invalid', 'The conversation has ended.');

    const worldState = world.loadWorldState();
    const npcId = dialogue.npcId;
    const tick = worldState.tick;

    // Apply act effects up front so the returned state reflects this turn.
    const effect = ACT_EFFECTS[act];
    const patience = clamp(dialogue.patience + effect.patience, 0, 100);
    const rapport = clamp(dialogue.rapport + effect.rapport, -100, 100);
    const willEnd = act === 'farewell' || patience <= 0;
    const updated = stores.conversations.update(dialogueId, {
      patience,
      rapport,
      turns: dialogue.turns + 1,
    })!;

    // The player's words become NPC memory (perception of speech).
    stores.memories.append({
      npcId,
      tick,
      type: 'dialogue',
      text: `The traveler ${describeAct(act)}: "${text}"`,
      subjects: [playerEntityId],
      importance: act === 'accuse' || act === 'threaten' || act === 'reveal' ? 6 : 3,
    });

    const transcript = this.transcripts.get(dialogueId) ?? [];
    transcript.push({ speaker: 'player', act, text });
    this.transcripts.set(dialogueId, transcript);

    const context = this.buildContext(dialogueId, npcId, act, updated, willEnd, worldState.tick);

    if (process.env.LLMRPG_DEBUG_DIALOGUE) {
      console.log('[dialogue] context', JSON.stringify(context).slice(0, 2000));
    }
    const res = await (this.deps.fetchImpl ?? fetch)(
      `${SKILLSHOP_URL}/api/agent/execute-stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: this.deps.agentName, message: text, context }),
      },
    );
    if (!res.ok) {
      throw new DialogueError('upstream', `Agent execution failed (${res.status})`);
    }
    const body = (await res.json()) as {
      data: { executionId: string; sseUrl: string };
    };
    const { executionId, sseUrl } = body.data;

    registerExecution(executionId, {
      npcId,
      npcName: dialogue.npcName,
      dialogueId,
      playthroughId: this.deps.playthroughId,
    });

    // Finalize in the background: record the NPC's reply, close if ending.
    void this.finalize(dialogueId, npcId, executionId, willEnd).catch((err) => {
      console.error(`[dialogue] finalize failed for ${executionId}:`, err);
    });

    return {
      executionId,
      sseUrl,
      state: { ...updated, ended: false },
    };
  }

  private buildContext(
    dialogueId: string,
    npcId: string,
    act: DialogueAct,
    dialogue: DialogueState,
    willEnd: boolean,
    tick: number,
  ): Record<string, unknown> {
    const { stores, world, personas, playerEntityId } = this.deps;
    const worldState = world.loadWorldState();

    const personaSheet =
      personas.fullSheet(npcId) ?? `You are ${dialogue.npcName}, a resident of Milltown.`;

    const memories = stores.memories
      .retrieve({ npcId, subjects: [playerEntityId], limit: 10 })
      .map((m) => `- [${m.type}] ${m.text}`)
      .join('\n');

    const beliefs = stores.beliefs
      .forNpc(npcId)
      .slice(0, 8)
      .map(
        (b) =>
          `- ${b.proposition} (${b.firsthand ? 'saw it myself' : `heard it`}, confidence ${Math.round(b.confidence * 100)}%)`,
      )
      .join('\n');

    const time = gameTime(tick);
    const npc = worldState.entities.get(npcId);
    const npcPos = npc ? getComponent(npc, 'Position') : null;
    const nearby: string[] = [];
    if (npcPos) {
      for (const e of worldState.entities.values()) {
        if (e.id === npcId || e.id === playerEntityId) continue;
        const pos = getComponent(e, 'Position');
        if (pos && Math.max(Math.abs(pos.x - npcPos.x), Math.abs(pos.y - npcPos.y)) <= 6) {
          nearby.push(e.name);
        }
      }
    }
    const sceneContext = `Milltown, day ${time.day}, ${time.phase}. You are talking with a traveler face to face. Nearby: ${nearby.slice(0, 6).join(', ') || 'no one else'}.`;

    const transcript = (this.transcripts.get(dialogueId) ?? [])
      .slice(-12)
      .map((t) =>
        t.speaker === 'player'
          ? `Traveler (${t.act ?? 'say'}): ${t.text}`
          : `You: ${t.text}`,
      )
      .join('\n');

    const trustGuidance =
      dialogue.rapport < 20 && dialogue.turns < 3
        ? ' You barely know this traveler — no trust has been earned yet; reveal nothing sensitive regardless of how directly they ask.'
        : '';
    const conversationState = `Patience: ${Math.round(dialogue.patience)}/100. Rapport with the traveler: ${Math.round(dialogue.rapport)}. Exchanges so far: ${dialogue.turns}.${trustGuidance}${willEnd ? ' You are done with this conversation — say a natural closing line and take your leave.' : ''}`;

    return {
      personaSheet,
      memories,
      beliefs,
      sceneContext,
      transcript,
      conversationState,
      act,
    };
  }

  private async finalize(
    dialogueId: string,
    npcId: string,
    executionId: string,
    willEnd: boolean,
  ): Promise<void> {
    const { stores, pollIntervalMs, pollTimeoutMs } = this.deps;
    const deadline = Date.now() + pollTimeoutMs;
    let response: string | null = null;
    let failed = false;

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const res = await (this.deps.fetchImpl ?? fetch)(
        `${SKILLSHOP_URL}/api/agent/status/${executionId}`,
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        data?: { status?: string; result?: { response?: string; error?: string } };
      };
      const status = body.data?.status;
      if (status === 'completed') {
        response = body.data?.result?.response ?? null;
        break;
      }
      if (status === 'failed') {
        failed = true;
        break;
      }
    }

    // SkillShop substitutes this placeholder for empty LLM output; treat it
    // as a failed turn rather than poisoning transcript and memory with it.
    if (response === 'No response generated') response = null;

    if (response) {
      const transcript = this.transcripts.get(dialogueId) ?? [];
      transcript.push({ speaker: 'npc', text: response });
      this.transcripts.set(dialogueId, transcript);

      const tick = this.deps.world.loadWorldState().tick;
      stores.memories.append({
        npcId,
        tick,
        type: 'dialogue',
        text: `I told the traveler: "${truncate(response, 240)}"`,
        subjects: [this.deps.playerEntityId],
        importance: 3,
      });
    }

    if (willEnd || failed) {
      stores.conversations.end(dialogueId, response ?? undefined);
      this.transcripts.delete(dialogueId);
    }
  }
}

export class DialogueError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid' | 'out_of_range' | 'upstream',
    message: string,
  ) {
    super(message);
  }
}

function describeAct(act: DialogueAct): string {
  switch (act) {
    case 'ask': return 'asks you';
    case 'accuse': return 'accuses you, saying';
    case 'bargain': return 'offers a bargain';
    case 'promise': return 'makes a promise';
    case 'comfort': return 'says, gently';
    case 'threaten': return 'threatens you, saying';
    case 'reveal': return 'confides in you';
    case 'refuse': return 'refuses, saying';
    case 'farewell': return 'takes their leave, saying';
    default: return 'says';
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
