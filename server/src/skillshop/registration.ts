import {
  LLMRPG_LIBRARY,
  LLMRPG_SERVER_URL,
  NPC_PLACEHOLDER_AGENT,
  SKILLSHOP_URL,
  WORLD_LOOK_TOOL,
} from '@llmrpg/shared';
import {
  BRAM_PERSONA_PROMPT,
  NPC_ACTOR_PROMPT,
  NPC_REFLECTOR_PROMPT,
} from './prompts';

export const NPC_ACTOR_AGENT = 'llmrpg_npc_actor';
export const NPC_REFLECTOR_AGENT = 'llmrpg_npc_reflector';

const NPC_TOOLS = [
  {
    name: 'share_claim',
    displayName: 'Share Claim',
    description:
      'Record a factual claim you are telling the traveler (gossip, testimony, lore) so it enters their journal with you as the source. Call this whenever you state something factual about the world or another person.',
    inputSchema: {
      type: 'object',
      properties: {
        proposition: { type: 'string', description: 'The claim, one sentence, third person' },
        about: { type: 'array', items: { type: 'string' }, description: 'Names or ids of people/places the claim is about' },
        firsthand: { type: 'boolean', description: 'true if you personally witnessed it' },
      },
      required: ['proposition'],
    },
    endpointPath: '/api/tools/npc/share-claim',
    entityTypes: [{ name: 'claim', displayName: 'Claim', iconHint: 'message' }],
  },
  {
    name: 'make_promise',
    displayName: 'Make Promise',
    description:
      'Record a commitment you are making to the traveler ("come back at dusk", "I will keep your secret"). Call this whenever you commit to do or not do something.',
    inputSchema: {
      type: 'object',
      properties: {
        terms: { type: 'string', description: 'The promise, one sentence' },
        deadline_in_ticks: { type: 'number', description: 'Optional in-game deadline, ticks from now (60 = a quarter day)' },
      },
      required: ['terms'],
    },
    endpointPath: '/api/tools/npc/make-promise',
    entityTypes: [{ name: 'promise', displayName: 'Promise', iconHint: 'star' }],
  },
  {
    name: 'update_relationship',
    displayName: 'Update Relationship',
    description:
      'Adjust how you feel about the traveler after a meaningful exchange. Small deltas from -10 to 10 for trust, affection, fear, plus a short note explaining why.',
    inputSchema: {
      type: 'object',
      properties: {
        trust: { type: 'number' },
        affection: { type: 'number' },
        fear: { type: 'number' },
        note: { type: 'string', description: 'Short in-character reason' },
      },
      required: ['note'],
    },
    endpointPath: '/api/tools/npc/update-relationship',
  },
  {
    name: 'memory_search',
    displayName: 'Memory Search',
    description:
      'Search your own memories for a topic before answering. Returns your recollections, most relevant first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
    endpointPath: '/api/tools/npc/memory-search',
  },
] as const;

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerTool(): Promise<void> {
  const res = await fetch(`${SKILLSHOP_URL}/api/tools/register-http`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: WORLD_LOOK_TOOL,
      displayName: 'World Look',
      description:
        'Look at the surroundings or a specific target in the game world. Returns a description and visible entities.',
      category: 'llmrpg',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'What to look at; omit for general surroundings',
          },
        },
      },
      httpEndpoint: `${LLMRPG_SERVER_URL}/api/tools/world-look`,
      httpMethod: 'POST',
      timeoutMs: 15000,
      library: LLMRPG_LIBRARY,
      entityTypes: [
        { name: 'npc', displayName: 'NPC', iconHint: 'user' },
        { name: 'location', displayName: 'Location', iconHint: 'folder' },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tool register failed (${res.status}): ${body}`);
  }
}

async function registerAgent(): Promise<void> {
  const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: NPC_PLACEHOLDER_AGENT,
      displayName: 'Bram the Gatekeeper (placeholder)',
      description: 'Phase 0 placeholder NPC proving the three-process pipeline',
      // Must be one of SkillShop's AGENT_CATEGORIES (shared/schema/agents.ts);
      // llmrpg agents are grouped via `library` instead.
      category: 'custom',
      library: LLMRPG_LIBRARY,
      defaultModel: 'claude-4-5-haiku',
      modelConfig: { temperature: 0.7, maxTokens: 1024 },
      enabledTools: [WORLD_LOOK_TOOL],
      memoryEnabled: false,
      isEnabledInSidebar: false,
      systemPromptTemplate: BRAM_PERSONA_PROMPT,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`agent register failed (${res.status}): ${body}`);
  }
}

async function registerNpcTools(): Promise<void> {
  for (const tool of NPC_TOOLS) {
    const res = await fetch(`${SKILLSHOP_URL}/api/tools/register-http`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tool.name,
        displayName: tool.displayName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        httpEndpoint: `${LLMRPG_SERVER_URL}${tool.endpointPath}`,
        httpMethod: 'POST',
        timeoutMs: 15000,
        library: LLMRPG_LIBRARY,
        ...('entityTypes' in tool ? { entityTypes: tool.entityTypes } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`tool ${tool.name} register failed (${res.status}): ${await res.text()}`);
    }
  }
}

async function registerPhase2Agents(): Promise<void> {
  const agents = [
    {
      name: NPC_ACTOR_AGENT,
      displayName: 'llmrpg NPC Actor',
      description:
        'Generic NPC actor: persona, memories, beliefs, and scene injected per execution (DESIGN §6.6).',
      systemPromptTemplate: NPC_ACTOR_PROMPT,
      defaultModel: 'claude-4-5-haiku',
      modelConfig: { temperature: 0.8, maxTokens: 1024 },
      enabledTools: ['share_claim', 'make_promise', 'update_relationship', 'memory_search'],
    },
    {
      name: NPC_REFLECTOR_AGENT,
      displayName: 'llmrpg NPC Reflector',
      description: 'Deliberate-tier reflection: distills NPC memories into insights (strict JSON).',
      systemPromptTemplate: NPC_REFLECTOR_PROMPT,
      defaultModel: 'claude-4-5-haiku',
      modelConfig: { temperature: 0.4, maxTokens: 800 },
      enabledTools: [],
    },
  ];
  for (const agent of agents) {
    const res = await fetch(`${SKILLSHOP_URL}/api/agent/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...agent,
        category: 'custom',
        library: LLMRPG_LIBRARY,
        memoryEnabled: false,
        isEnabledInSidebar: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`agent ${agent.name} register failed (${res.status}): ${await res.text()}`);
    }
  }
}

/**
 * Register llmrpg tools + agents with SkillShop (Phase 0 placeholder plus
 * the Phase 2 NPC actor/reflector and NPC tools).
 * Retries while SkillShop may still be booting; never throws to the caller.
 */
export async function registerWithSkillShop(): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await registerTool();
      await registerNpcTools();
      await registerAgent();
      await registerPhase2Agents();
      console.log(
        `[skillshop] registration ok (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `[skillshop] registration failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${msg}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error(
    `[skillshop] gave up after ${MAX_ATTEMPTS} attempts; server continues without SkillShop registration`,
  );
  return false;
}
