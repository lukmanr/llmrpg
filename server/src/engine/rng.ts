/**
 * Deterministic RNG for rules that need dice (attack damage).
 * Default seed is derived from the playthrough id.
 */

export type Rng = () => number;

/** Mulberry32 PRNG; returns values in [0, 1). */
export function createSeededRng(seed: string): Rng {
  let state = hashString(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform integer in [min, max] inclusive. */
export function rollInt(rng: Rng, min: number, max: number): number {
  if (max < min) throw new Error(`rollInt: max ${max} < min ${min}`);
  const span = max - min + 1;
  return min + Math.floor(rng() * span);
}
