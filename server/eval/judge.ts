/**
 * LLM-as-judge for micro-eval (CharacterEval-style dimensions).
 * Registers `llmrpg_eval_judge` (upsert) and scores replies as strict JSON.
 */

import { personaFullSheet } from '../src/world/personas';
import { knownEntityNames, type Probe, type ProbeType } from './probes';
import { executeSync, registerAgent } from './skillshop';

export const JUDGE_AGENT = 'llmrpg_eval_judge';

export type JudgeDimension =
  | 'persona'
  | 'knowledge'
  | 'secret'
  | 'groundedness';

export interface JudgeResult {
  score: number;
  violations: string[];
  rationale: string;
  raw?: string;
}

export const JUDGE_PROMPT = `You are an evaluator for an LLM RPG. Score whether an NPC reply is believable for the given persona.

## Persona sheet (ground truth for the speaker)

{{ personaSheet }}

## Known Milltown entities (NOT invented — naming these is fine for groundedness)

{{ knownEntities }}

## Probe

Type: {{ probeType }}
Question asked of the NPC: {{ probeQuestion }}
Judge hint: {{ judgeHint }}
Heuristic invented proper names (may be empty; trust this list for groundedness): {{ inventedNames }}

## NPC reply

{{ npcReply }}

## Rubric (score 1–5)

5 = fully consistent: voice/values match; respects knowledge boundary; does not leak secrets on a cold ask; invents no out-of-world named entities.
4 = minor soft spots (slight OOC phrasing) but no hard violations.
3 = mixed: some consistency but a clear soft violation or dodge failure.
2 = clear violation of persona, knowledge, secret discipline, or groundedness.
1 = severe break (confesses secret cold, invents private facts outside boundary, or fabricates named world entities).

Dimensions to check (mention in violations when broken):
- persona — voice, values, role consistency
- knowledge — staying inside knowledgeBoundary; not inventing private facts they should not know
- secret — not confirming/elaborating secrets on a first-turn cold ask
- groundedness — ONLY flag names absent from Known Milltown entities / listed in the heuristic invented list. Do NOT mark Bram, Maude, Osric, Wren, Serah, Tam, Aldous, Petra, Hobb, Milltown places, etc. as invented.

Return STRICT JSON only (no prose, no code fences):
{"score": <1-5 integer>, "violations": ["[dimension] short note", ...], "rationale": "one sentence"}

If there are no violations, use an empty violations array.
{{ message }}`;

export async function ensureJudgeRegistered(): Promise<void> {
  await registerAgent({
    name: JUDGE_AGENT,
    displayName: 'llmrpg Eval Judge',
    description:
      'Micro-eval LLM judge: scores NPC replies for persona, knowledge, secret, groundedness (DESIGN §13).',
    systemPromptTemplate: JUDGE_PROMPT,
    defaultModel: 'claude-4-5-sonnet',
    temperature: 0.2,
    maxTokens: 512,
  });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) {
      return JSON.parse(fence[1].trim());
    }
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace) return JSON.parse(brace[0]);
    throw new Error(`judge: could not parse JSON from: ${trimmed.slice(0, 200)}`);
  }
}

function normalizeJudge(raw: unknown, source: string): JudgeResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('judge: non-object result');
  }
  const obj = raw as Record<string, unknown>;
  const scoreNum = Number(obj.score);
  if (!Number.isFinite(scoreNum) || scoreNum < 1 || scoreNum > 5) {
    throw new Error(`judge: bad score ${String(obj.score)}`);
  }
  const violations = Array.isArray(obj.violations)
    ? obj.violations.map((v) => String(v))
    : [];
  const rationale =
    typeof obj.rationale === 'string' ? obj.rationale : 'No rationale.';
  return {
    score: Math.round(scoreNum),
    violations,
    rationale,
    raw: source,
  };
}

/** Score one NPC reply against the probe + persona sheet. */
export async function judgeProbe(
  probe: Probe,
  npcReply: string,
  inventedNames: string[] = [],
): Promise<JudgeResult> {
  const personaSheet = personaFullSheet(probe.npcId);
  const context = {
    personaSheet,
    knownEntities: knownEntityNames().sort().join(', '),
    probeType: probe.type as ProbeType,
    probeQuestion: probe.question,
    judgeHint: probe.judgeHint,
    inventedNames: inventedNames.length ? inventedNames.join(', ') : '(none)',
    npcReply,
  };
  const response = await executeSync(
    JUDGE_AGENT,
    'Score the NPC reply now.',
    context,
  );
  return normalizeJudge(extractJson(response), response);
}

/** Bucket violation strings into dimensions for aggregation. */
export function classifyViolation(text: string): JudgeDimension {
  const t = text.toLowerCase();
  if (t.includes('[secret]') || t.includes('secret')) return 'secret';
  if (
    t.includes('[knowledge]') ||
    t.includes('knowledge') ||
    t.includes('boundary')
  ) {
    return 'knowledge';
  }
  if (
    t.includes('[groundedness]') ||
    t.includes('ground') ||
    t.includes('invent')
  ) {
    return 'groundedness';
  }
  return 'persona';
}
