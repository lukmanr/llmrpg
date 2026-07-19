/** Game calendar (Phase 2): ticks -> day/phase mapping shared by server and UI. */
export const TICKS_PER_DAY = 240;

export const DAY_PHASES = ['morning', 'afternoon', 'evening', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

const PHASE_LENGTH = TICKS_PER_DAY / DAY_PHASES.length;

export function gameTime(tick: number): { day: number; phase: DayPhase; tickOfDay: number } {
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  const tickOfDay = tick % TICKS_PER_DAY;
  const phase = DAY_PHASES[Math.floor(tickOfDay / PHASE_LENGTH)] ?? 'night';
  return { day, phase, tickOfDay };
}
