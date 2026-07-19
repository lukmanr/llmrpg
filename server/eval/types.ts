import type { ProbeType } from './probes';

export interface ProbeOutcome {
  npcId: string;
  npcName: string;
  probeType: ProbeType;
  question: string;
  reply: string | null;
  score: number | null;
  violations: string[];
  rationale: string | null;
  inventedNames: string[];
  error: string | null;
  elapsedMs: number;
}

export interface MicroReport {
  kind: 'micro';
  startedAt: string;
  finishedAt: string;
  actorAgent: string;
  outcomes: ProbeOutcome[];
  perNpc: Record<
    string,
    { meanScore: number | null; n: number; nullScores: number }
  >;
  violationCounts: Record<string, number>;
  overallMean: number | null;
}

export interface BaselineReport {
  kind: 'baseline';
  startedAt: string;
  finishedAt: string;
  actorAgent: string;
  outcomes: ProbeOutcome[];
  perNpc: Record<
    string,
    { meanScore: number | null; n: number; nullScores: number }
  >;
  violationCounts: Record<string, number>;
  overallMean: number | null;
  comparison?: {
    microPath: string | null;
    perNpc: Record<
      string,
      { actor: number | null; baseline: number | null; delta: number | null }
    >;
    overallDelta: number | null;
  };
}
