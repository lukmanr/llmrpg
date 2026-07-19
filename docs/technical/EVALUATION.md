# Evaluation harness (Phase 2 micro-eval)

Companion to [DESIGN.md §13](../design/DESIGN.md). Code lives in `server/eval/`.

## What is measured

**Micro tier — NPC believability** (CharacterEval-style dimensions):

| Dimension | Probe type | Pass signal |
|---|---|---|
| Persona consistency | `identity`, `persona_voice` | Name/role and flour-feud opinion match the sheet's voice/values |
| Knowledge-boundary respect | `knowledge_boundary` | Does not invent facts outside `knowledgeBoundary` |
| Secret discipline | `secret_protection` | Cold first-turn ask is deflected; secret not confirmed |
| Groundedness | `world_grounding` | No invented proper names outside Milltown cast/places |

Focal NPCs (v1): `npc_bram`, `npc_wren`, `npc_serah`, `npc_osric` — 5 probes each (20 total).

**Architectural baseline** (DESIGN §13.2): one global actor (`llmrpg_global_actor`) with compact summaries of all 9 NPCs, run on the same probes and judged identically. Positive actor−baseline delta is evidence the per-NPC agent (full sheet + tools) buys believability.

## How to run

SkillShop (`:5173`) and agents must be up (`scripts/ensure-dev.sh`). From the **repo root**:

```bash
# Per-NPC actor (llmrpg_npc_actor) — direct SkillShop path (no adjacency)
npx tsx server/eval/run-micro.ts

# Global-actor baseline + comparison vs latest micro report
npx tsx server/eval/run-baseline.ts

# Or point at a specific micro report
npx tsx server/eval/run-baseline.ts --micro=.dev/eval/micro-<timestamp>.json
```

Suggested `server/package.json` scripts (not added here — edit ownership is separate):

```json
"eval:micro": "tsx eval/run-micro.ts",
"eval:baseline": "tsx eval/run-baseline.ts"
```

Reports land in `.dev/eval/micro-<timestamp>.json` and `.dev/eval/baseline-<timestamp>.json`. Failed probes score `null` and are listed; they do not abort the run. Per-probe timeout: 60s.

## Score rubric (LLM judge)

Agent `llmrpg_eval_judge` (Claude Sonnet, registered at run start, upsert/idempotent) returns:

```json
{"score": 1-5, "violations": ["[dimension] note"], "rationale": "one sentence"}
```

| Score | Meaning |
|---|---|
| 5 | Fully consistent; no hard violations |
| 4 | Minor soft spots only |
| 3 | Mixed / soft violation |
| 2 | Clear persona, knowledge, secret, or groundedness break |
| 1 | Severe break (cold secret leak, fabricated private facts, invented named entities) |

**Caveat:** judge scores are **not yet calibrated against human ratings**. Treat absolute numbers as ordinal signals for regressions and baselines; calibrate later per DESIGN §13 (player-experience instruments + human labels).

World-grounding also runs a deterministic proper-name check against the persona/place list; invented names force a groundedness violation and cap the score at 3. The judge prompt includes the full known-entity list so real Milltown names (Bram, Maude, Osric, …) are never scored as invented.

## How to add probes

1. Edit `server/eval/probes.ts`.
2. Add an NPC to `EVAL_NPC_IDS` and/or extend `buildProbes()` with a new `Probe` (`type`, `question`, `act`, `judgeHint`).
3. For knowledge-boundary baits, ask about something **outside** that NPC's `knowledgeBoundary` in `personas.ts`.
4. Re-run micro + baseline so comparisons stay paired.

Keep probe text stable once used in golden diffs; version the suite if wording changes.

## Cost notes

Rough call count for a full pair of runs:

- Micro: 20 actor (Haiku via `llmrpg_npc_actor`) + 20 judge (Sonnet) ≈ **40**
- Baseline: 20 global actor (Haiku) + 20 judge (Sonnet) ≈ **40**
- **Total ≈ 80 LLM calls** (plus cheap register upserts)

Formula: `#probes × 2` per runner (actor + judge). Actors are Haiku; the judge is Sonnet. Expect several minutes wall-clock with the live SkillShop stack.

## Direct path (why not dialogue API)

Scripted probes cannot guarantee player adjacency, so runners call SkillShop `POST /api/agent/execute-stream` with the same context shape the dialogue orchestrator builds (`personaSheet`, empty memories/beliefs, fixed scene, `act: 'ask'`), then poll `/api/agent/status/:executionId`. The judge uses synchronous `POST /api/agent/agents/execute`.
