/**
 * Phase 2 micro-eval suite (DESIGN §13).
 *
 * Runners (from repo root — package.json scripts not required):
 *   npx tsx server/eval/run-micro.ts
 *   npx tsx server/eval/run-baseline.ts
 *
 * Suggested npm script names (add to server/package.json when convenient):
 *   "eval:micro": "tsx eval/run-micro.ts"
 *   "eval:baseline": "tsx eval/run-baseline.ts"
 */

export {
  buildProbes,
  EVAL_NPC_IDS,
  inventedProperNames,
  knownEntityNames,
  type EvalNpcId,
  type Probe,
  type ProbeType,
} from './probes';

export {
  ensureJudgeRegistered,
  JUDGE_AGENT,
  JUDGE_PROMPT,
  judgeProbe,
  classifyViolation,
  type JudgeResult,
  type JudgeDimension,
} from './judge';

export {
  GLOBAL_ACTOR,
  ensureGlobalActorRegistered,
} from './run-baseline';

export type { BaselineReport, MicroReport, ProbeOutcome } from './types';
