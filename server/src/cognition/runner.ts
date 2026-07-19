import type { WorldState } from '../engine/state';
import type { CognitionStores, JobRecord } from './api';
import { runGossipJob } from './gossip';
import { runReflectionJob, type ExecuteAgentFn } from './reflection';

export interface JobRunnerDeps {
  stores: CognitionStores;
  getWorldState: () => WorldState;
  personaSummaryFor: (npcId: string) => string;
  intervalMs?: number;
  /** Injectable for tests; defaults to real SkillShop execute via reflection. */
  executeAgent?: ExecuteAgentFn;
  /** Current sim tick for claim eligibility; defaults to world.tick. */
  getTick?: () => number;
  log?: (line: string) => void;
}

export interface JobRunner {
  start(): void;
  stop(): void;
  runOnce(): Promise<number>;
}

/**
 * Durable Deliberate-tier job runner: claims up to 2 jobs per pass and
 * dispatches reflection / gossip. Never throws out of the loop.
 */
export function createJobRunner(deps: JobRunnerDeps): JobRunner {
  const intervalMs = deps.intervalMs ?? 4000;
  const log = deps.log ?? ((line: string) => console.log(line));
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function dispatch(job: JobRecord): Promise<void> {
    const world = deps.getWorldState();
    if (job.kind === 'reflection') {
      const npcId = job.npcId;
      if (!npcId) throw new Error('reflection job missing npcId');
      await runReflectionJob(
        deps.stores,
        npcId,
        deps.personaSummaryFor(npcId),
        deps.executeAgent,
      );
      return;
    }
    if (job.kind === 'gossip') {
      const payloadTick =
        typeof job.payload.tick === 'number' ? job.payload.tick : undefined;
      runGossipJob(deps.stores, world, { tick: payloadTick });
      return;
    }
    throw new Error(`unknown job kind: ${(job as JobRecord).kind}`);
  }

  async function runOnce(): Promise<number> {
    const world = deps.getWorldState();
    const tick = deps.getTick?.() ?? world.tick;
    const claimed = deps.stores.jobs.claim(tick, 2);
    let completed = 0;

    for (const job of claimed) {
      try {
        await dispatch(job);
        deps.stores.jobs.complete(job.id);
        completed += 1;
        log(`[cognition] job ${job.id} ${job.kind} done (npc=${job.npcId ?? '-'})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retry = job.attempts < 3;
        deps.stores.jobs.fail(job.id, message, retry);
        log(`[cognition] job ${job.id} ${job.kind} fail: ${message} retry=${retry}`);
      }
    }

    return completed;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = true;
        void runOnce()
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            log(`[cognition] runOnce error: ${message}`);
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    runOnce,
  };
}
