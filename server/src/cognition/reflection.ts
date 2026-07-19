import { executeAgent, type ExecuteAgentResult } from '../skillshop/execute';
import type { CognitionStores } from './api';

export type ExecuteAgentFn = (
  agentName: string,
  message: string,
  context?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<ExecuteAgentResult>;

export interface ReflectionAdjustment {
  otherEntityId: string;
  trust?: number;
  affection?: number;
  fear?: number;
  note?: string;
}

export interface ReflectionResult {
  reflections: string[];
  relationshipAdjustments: ReflectionAdjustment[];
  rawResponse: string;
  parsed: boolean;
}

interface ParsedReflectionJson {
  reflections?: unknown;
  relationshipAdjustments?: unknown;
}

/** Extract the first JSON object block from an agent response. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function clampAdj(n: number): number {
  return Math.max(-10, Math.min(10, n));
}

function parseReflectionResponse(raw: string): {
  reflections: string[];
  relationshipAdjustments: ReflectionAdjustment[];
  parsed: boolean;
} {
  const block = extractJsonObject(raw);
  if (!block) {
    return { reflections: [raw.trim()].filter(Boolean), relationshipAdjustments: [], parsed: false };
  }
  try {
    const json = JSON.parse(block) as ParsedReflectionJson;
    const reflections = Array.isArray(json.reflections)
      ? json.reflections.filter((r): r is string => typeof r === 'string').slice(0, 3)
      : [];
    const relationshipAdjustments: ReflectionAdjustment[] = [];
    if (Array.isArray(json.relationshipAdjustments)) {
      for (const item of json.relationshipAdjustments.slice(0, 3)) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (typeof row.otherEntityId !== 'string') continue;
        const adj: ReflectionAdjustment = { otherEntityId: row.otherEntityId };
        if (typeof row.trust === 'number') adj.trust = clampAdj(row.trust);
        if (typeof row.affection === 'number') adj.affection = clampAdj(row.affection);
        if (typeof row.fear === 'number') adj.fear = clampAdj(row.fear);
        if (typeof row.note === 'string') adj.note = row.note;
        relationshipAdjustments.push(adj);
      }
    }
    if (reflections.length === 0) {
      return { reflections: [raw.trim()].filter(Boolean), relationshipAdjustments: [], parsed: false };
    }
    return { reflections, relationshipAdjustments, parsed: true };
  } catch {
    return { reflections: [raw.trim()].filter(Boolean), relationshipAdjustments: [], parsed: false };
  }
}

/** Pull entity-id-looking tokens from reflection prose for subjects. */
function subjectsFromText(text: string): string[] {
  const ids = text.match(/\b[a-z][a-z0-9_]{2,}\b/gi) ?? [];
  return [...new Set(ids)].slice(0, 8);
}

/**
 * Deliberate-tier reflection: retrieve salient memories, call the reflector
 * agent, store insights and apply relationship deltas.
 */
export async function runReflectionJob(
  stores: CognitionStores,
  npcId: string,
  personaSummary: string,
  execute: ExecuteAgentFn = executeAgent,
): Promise<ReflectionResult> {
  const memories = stores.memories.retrieve({
    npcId,
    limit: 20,
  });

  const memoryList = memories
    .map((m, i) => `${i + 1}. [tick ${m.tick} · ${m.type} · imp ${m.importance}] ${m.text}`)
    .join('\n');

  const message = [
    'Reflect on these recent memories and return STRICT JSON only:',
    '{"reflections":["..."],"relationshipAdjustments":[{"otherEntityId":"...","trust":0,"affection":0,"fear":0,"note":"..."}]}',
    '',
    'Memories:',
    memoryList || '(none)',
  ].join('\n');

  let rawResponse: string;
  try {
    const result = await execute('llmrpg_npc_reflector', message, { personaSummary, npcId });
    rawResponse = result.response;
  } catch (err) {
    rawResponse = err instanceof Error ? err.message : String(err);
    stores.memories.append({
      npcId,
      tick: memories[0]?.tick ?? 0,
      type: 'reflection',
      text: rawResponse,
      subjects: [],
      importance: 6,
    });
    return { reflections: [rawResponse], relationshipAdjustments: [], rawResponse, parsed: false };
  }

  const { reflections, relationshipAdjustments, parsed } = parseReflectionResponse(rawResponse);
  const tick = memories[0]?.tick ?? 0;

  for (const text of reflections) {
    stores.memories.append({
      npcId,
      tick,
      type: 'reflection',
      text,
      subjects: subjectsFromText(text),
      importance: 6,
    });
  }

  if (parsed) {
    for (const adj of relationshipAdjustments) {
      const delta: { trust?: number; affection?: number; fear?: number } = {};
      if (adj.trust !== undefined) delta.trust = adj.trust;
      if (adj.affection !== undefined) delta.affection = adj.affection;
      if (adj.fear !== undefined) delta.fear = adj.fear;
      stores.relationships.adjust(
        npcId,
        adj.otherEntityId,
        delta,
        adj.note ?? 'reflection',
        tick,
      );
    }
  }

  return { reflections, relationshipAdjustments: parsed ? relationshipAdjustments : [], rawResponse, parsed };
}
