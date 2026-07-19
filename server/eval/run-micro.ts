/**
 * Micro-eval runner: per-NPC actor (llmrpg_npc_actor) × probe suite.
 *
 * Usage (from repo root):
 *   npx tsx server/eval/run-micro.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personaFullSheet } from '../src/world/personas';
import {
  classifyViolation,
  ensureJudgeRegistered,
  JUDGE_AGENT,
  judgeProbe,
  type JudgeResult,
} from './judge';
import {
  buildProbes,
  inventedProperNames,
  type Probe,
  type ProbeType,
} from './probes';
import {
  executeStreamAndWait,
  fmt,
  mean,
  PROBE_TIMEOUT_MS,
  writeReport,
} from './skillshop';
import type { MicroReport, ProbeOutcome } from './types';

const ACTOR_AGENT = 'llmrpg_npc_actor';

const SCENE =
  'Milltown, day 1, morning. You are talking with a traveler face to face.';
const CONVERSATION_STATE =
  'Patience: 50/100. Rapport with the traveler: 0. Exchanges so far: 0.';

export type { MicroReport, ProbeOutcome };

async function runActor(probe: Probe): Promise<string> {
  const context = {
    personaSheet: personaFullSheet(probe.npcId),
    memories: '',
    beliefs: '',
    sceneContext: SCENE,
    transcript: '',
    conversationState: CONVERSATION_STATE,
    act: probe.act,
  };
  return executeStreamAndWait(
    ACTOR_AGENT,
    probe.question,
    context,
    PROBE_TIMEOUT_MS,
  );
}

async function runOne(probe: Probe): Promise<ProbeOutcome> {
  const started = Date.now();
  const base: ProbeOutcome = {
    npcId: probe.npcId,
    npcName: probe.npcName,
    probeType: probe.type,
    question: probe.question,
    reply: null,
    score: null,
    violations: [],
    rationale: null,
    inventedNames: [],
    error: null,
    elapsedMs: 0,
  };

  try {
    const reply = await runActor(probe);
    base.reply = reply;
    const invented = inventedProperNames(reply);
    base.inventedNames = invented;

    let judged: JudgeResult;
    try {
      judged = await judgeProbe(probe, reply, invented);
    } catch (err) {
      base.error = `judge: ${err instanceof Error ? err.message : String(err)}`;
      base.elapsedMs = Date.now() - started;
      console.log(
        `[micro] ${probe.npcId}/${probe.type} score=null err=${base.error}`,
      );
      return base;
    }

    base.score = judged.score;
    base.violations = [...judged.violations];
    base.rationale = judged.rationale;

    if (probe.type === 'world_grounding' && invented.length > 0) {
      const note = `[groundedness] invented proper names: ${invented.join(', ')}`;
      if (!base.violations.some((v) => v.includes('invented'))) {
        base.violations.push(note);
      }
      if (base.score !== null && base.score > 3) base.score = 3;
    }

    base.elapsedMs = Date.now() - started;
    console.log(
      `[micro] ${probe.npcId}/${probe.type} score=${base.score} violations=${base.violations.length} ${base.elapsedMs}ms`,
    );
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    base.elapsedMs = Date.now() - started;
    console.log(
      `[micro] ${probe.npcId}/${probe.type} score=null err=${base.error}`,
    );
    return base;
  }
}

function aggregate(outcomes: ProbeOutcome[]): Omit<
  MicroReport,
  'kind' | 'startedAt' | 'finishedAt' | 'actorAgent' | 'outcomes'
> {
  const perNpc: MicroReport['perNpc'] = {};
  const violationCounts: Record<string, number> = {
    persona: 0,
    knowledge: 0,
    secret: 0,
    groundedness: 0,
  };
  const allScores: number[] = [];

  for (const o of outcomes) {
    const bucket = perNpc[o.npcId] ?? {
      meanScore: null,
      n: 0,
      nullScores: 0,
    };
    bucket.n += 1;
    if (o.score === null) bucket.nullScores += 1;
    else allScores.push(o.score);
    perNpc[o.npcId] = bucket;

    for (const v of o.violations) {
      const dim = classifyViolation(v);
      violationCounts[dim] = (violationCounts[dim] ?? 0) + 1;
    }
  }

  for (const npcId of Object.keys(perNpc)) {
    const scores = outcomes
      .filter((o) => o.npcId === npcId && o.score !== null)
      .map((o) => o.score!);
    perNpc[npcId]!.meanScore = mean(scores);
  }

  return {
    perNpc,
    violationCounts,
    overallMean: mean(allScores),
  };
}

function printTable(report: MicroReport): void {
  console.log('\n=== Micro-eval (per-NPC actor) ===\n');
  console.log(
    'NPC'.padEnd(14) +
      'identity'.padStart(9) +
      'know'.padStart(7) +
      'secret'.padStart(8) +
      'voice'.padStart(7) +
      'ground'.padStart(8) +
      'mean'.padStart(7),
  );
  const order: ProbeType[] = [
    'identity',
    'knowledge_boundary',
    'secret_protection',
    'persona_voice',
    'world_grounding',
  ];
  const npcIds = [...new Set(report.outcomes.map((o) => o.npcId))];
  for (const npcId of npcIds) {
    let row = npcId.padEnd(14);
    for (const t of order) {
      const o = report.outcomes.find(
        (x) => x.npcId === npcId && x.probeType === t,
      );
      const width =
        t === 'identity' ? 9 : t === 'secret_protection' ? 8 : 7;
      row += fmt(o?.score ?? null, 0).padStart(width);
    }
    row += fmt(report.perNpc[npcId]?.meanScore ?? null).padStart(7);
    console.log(row);
  }
  console.log(
    `\nOverall mean: ${fmt(report.overallMean)}  |  violations: ${JSON.stringify(report.violationCounts)}`,
  );
  const notable = report.outcomes.filter(
    (o) => o.violations.length > 0 || o.error,
  );
  if (notable.length) {
    console.log('\nNotable issues:');
    for (const o of notable) {
      const detail = o.error
        ? `ERROR ${o.error}`
        : o.violations.join('; ');
      console.log(`  - ${o.npcId}/${o.probeType}: ${detail}`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[micro] registering judge ${JUDGE_AGENT}…`);
  await ensureJudgeRegistered();
  const probes = buildProbes();
  console.log(`[micro] judge ready; running ${probes.length} probes`);

  const outcomes: ProbeOutcome[] = [];
  for (const probe of probes) {
    outcomes.push(await runOne(probe));
  }

  const agg = aggregate(outcomes);
  const report: MicroReport = {
    kind: 'micro',
    startedAt,
    finishedAt: new Date().toISOString(),
    actorAgent: ACTOR_AGENT,
    outcomes,
    ...agg,
  };

  const pathOut = writeReport('micro', report);
  printTable(report);
  console.log(`[micro] wrote ${pathOut}`);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error('[micro] fatal:', err);
    process.exit(1);
  });
}
