/**
 * XP, level, and rank math — pure, unit-tested (CLAUDE.md rule 10).
 *
 * XP is BOUNDED by design (gamification design law 1): every award comes from
 * a fixed, capped event — never from volume, sets, duration, or weight lifted.
 * This file only computes the numbers; awarding/idempotency lives server-side
 * in the award engine (xpEvents ledger keyed by accountId+kind+sourceKey).
 */

/** Fixed XP value per bounded event kind. Never scale these by volume/weight. */
export const XP_AWARDS = {
  daily_workout: 50, // first finished workout each day, max 1/day
  streak_week: 100, // a weekly streak week counted
  checkin: 30, // a weekly check-in submitted
  pr: 20, // a PR, max PR_XP_WEEKLY_CAP credits/week
  badge: 50, // a badge earned
} as const;

export type XpAwardKind = keyof typeof XP_AWARDS;

/** Max PR-credit XP awards per calendar week (anti-cheat cap). */
export const PR_XP_WEEKLY_CAP = 5;

/**
 * Total XP required to REACH `level` (i.e. xpForLevel(level) is the XP total
 * at which `level` begins). Level 1 starts at 0 XP. Smooth quadratic curve —
 * strictly increasing, gets harder each level.
 */
export function xpForLevel(level: number): number {
  const lvl = Math.max(1, Math.floor(level));
  return 100 * (lvl - 1) * (lvl - 1);
}

/** The level a total XP amount falls into. Level 1 for any xp < xpForLevel(2). */
export function levelForXp(xp: number): number {
  const safeXp = Math.max(0, xp);
  return Math.floor(Math.sqrt(safeXp / 100)) + 1;
}

export interface LevelProgress {
  level: number;
  /** XP earned past the start of the current level. */
  xpIntoLevel: number;
  /** XP needed in total to reach the next level from the current one. */
  xpForNextLevel: number;
}

/** Level + progress bar numbers for a total XP amount. */
export function levelProgress(xp: number): LevelProgress {
  const safeXp = Math.max(0, xp);
  const level = levelForXp(safeXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return {
    level,
    xpIntoLevel: safeXp - floor,
    xpForNextLevel: ceil - floor,
  };
}

export type Rank = 'bronze' | 'silver' | 'gold' | 'elite';

export interface RankInput {
  /** Distinct session-days in the trailing 90 days. */
  sessionDays90: number;
  weeklyTargetDays: number;
  lifetimeSessionDays: number;
  /** Check-ins submitted in the trailing 90 days. */
  checkIns90: number;
}

/**
 * Rank is a rolling-consistency read, not a leaderboard stat (design law 5:
 * personal-only, never shown competitively). Ratio = actual session-days over
 * the last 90 days vs. the target pace (weeklyTargetDays * 90/7), clamped to
 * [0,1] so overtraining can't inflate rank further than "on pace".
 */
export function computeRank(input: RankInput): Rank {
  const targetDays90 = input.weeklyTargetDays * (90 / 7);
  const ratio = targetDays90 > 0 ? Math.min(1, Math.max(0, input.sessionDays90 / targetDays90)) : 0;

  if (ratio >= 0.9 && input.lifetimeSessionDays >= 150 && input.checkIns90 >= 10) return 'elite';
  if (ratio >= 0.75 && input.lifetimeSessionDays >= 50 && input.checkIns90 >= 6) return 'gold';
  if (ratio >= 0.5 && input.lifetimeSessionDays >= 10) return 'silver';
  return 'bronze';
}
