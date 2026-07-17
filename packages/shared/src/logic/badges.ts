/**
 * Badge catalog + award computation — pure data + pure logic, unit-tested
 * (CLAUDE.md rule 10). Strength-club badges always start 'logged'; only a
 * coach can upgrade one to 'verified' (server-side, not here).
 *
 * Catalog is EXACTLY 42 badges:
 *   strength (17) + consistency (13) + mileage (5) + records (3) + crew (4)
 * Challenge badges (`challenge:<id>`) and the event-driven crew badge
 * (coach_pick) are awarded server-side outside this pure threshold
 * evaluator — see computeEarnedBadgeIds's doc for what it covers.
 *
 * The buddy badges (buddy_first, buddy_quest) were retired with the buddy
 * pairing feature (2026-07) — a catalog badge must always be earnable.
 * Legacy award rows for them may still exist server-side; they simply no
 * longer render (screens draw the catalog only).
 */

export type BadgeFamily = 'strength' | 'consistency' | 'mileage' | 'records' | 'crew';

export type BadgeIconKey =
  | 'barbell'
  | 'trophy'
  | 'flame'
  | 'sessions'
  | 'tonnage'
  | 'star'
  | 'clipboard'
  | 'buddies'
  | 'award'
  | 'comeback'
  | 'shield'
  | 'check';

export type CanonicalLift = 'bench' | 'squat' | 'deadlift' | 'ohp' | 'total';

export interface BadgeDef {
  id: string;
  family: BadgeFamily;
  name: string;
  /** One-sentence plain-language explanation of how the badge is earned. */
  description: string;
  icon: BadgeIconKey;
  sort: number;
  threshold?: number;
  lift?: CanonicalLift;
}

// ── Strength clubs (17) — e1RM thresholds in kg, canonical weight ──────────

/** "Reach a <kg> estimated 1-rep max on <lift> in a ranked workout." */
function strengthDesc(thresholdKg: number, liftLabel: string): string {
  return `Reach a ${thresholdKg} kg estimated 1-rep max on ${liftLabel} in a ranked workout.`;
}

/** "Get your combined best squat + bench + deadlift to <kg>." */
function totalDesc(thresholdKg: number): string {
  return `Get your combined best squat + bench + deadlift (estimated 1-rep maxes) to ${thresholdKg} kg.`;
}

const STRENGTH_BADGES: BadgeDef[] = [
  { id: 'bench_60', family: 'strength', name: '60 kg bench club', description: strengthDesc(60, 'bench press'), icon: 'barbell', sort: 100, threshold: 60, lift: 'bench' },
  { id: 'bench_100', family: 'strength', name: '100 kg bench club', description: strengthDesc(100, 'bench press'), icon: 'barbell', sort: 101, threshold: 100, lift: 'bench' },
  { id: 'bench_140', family: 'strength', name: '140 kg bench club', description: strengthDesc(140, 'bench press'), icon: 'barbell', sort: 102, threshold: 140, lift: 'bench' },
  { id: 'squat_60', family: 'strength', name: '60 kg squat club', description: strengthDesc(60, 'squat'), icon: 'barbell', sort: 110, threshold: 60, lift: 'squat' },
  { id: 'squat_100', family: 'strength', name: '100 kg squat club', description: strengthDesc(100, 'squat'), icon: 'barbell', sort: 111, threshold: 100, lift: 'squat' },
  { id: 'squat_140', family: 'strength', name: '140 kg squat club', description: strengthDesc(140, 'squat'), icon: 'barbell', sort: 112, threshold: 140, lift: 'squat' },
  { id: 'squat_180', family: 'strength', name: '180 kg squat club', description: strengthDesc(180, 'squat'), icon: 'barbell', sort: 113, threshold: 180, lift: 'squat' },
  { id: 'deadlift_100', family: 'strength', name: '100 kg deadlift club', description: strengthDesc(100, 'deadlift'), icon: 'barbell', sort: 120, threshold: 100, lift: 'deadlift' },
  { id: 'deadlift_140', family: 'strength', name: '140 kg deadlift club', description: strengthDesc(140, 'deadlift'), icon: 'barbell', sort: 121, threshold: 140, lift: 'deadlift' },
  { id: 'deadlift_180', family: 'strength', name: '180 kg deadlift club', description: strengthDesc(180, 'deadlift'), icon: 'barbell', sort: 122, threshold: 180, lift: 'deadlift' },
  { id: 'deadlift_220', family: 'strength', name: '220 kg deadlift club', description: strengthDesc(220, 'deadlift'), icon: 'barbell', sort: 123, threshold: 220, lift: 'deadlift' },
  { id: 'ohp_40', family: 'strength', name: '40 kg overhead press club', description: strengthDesc(40, 'overhead press'), icon: 'barbell', sort: 130, threshold: 40, lift: 'ohp' },
  { id: 'ohp_60', family: 'strength', name: '60 kg overhead press club', description: strengthDesc(60, 'overhead press'), icon: 'barbell', sort: 131, threshold: 60, lift: 'ohp' },
  { id: 'ohp_80', family: 'strength', name: '80 kg overhead press club', description: strengthDesc(80, 'overhead press'), icon: 'barbell', sort: 132, threshold: 80, lift: 'ohp' },
  { id: 'total_300', family: 'strength', name: '300 kg total club', description: totalDesc(300), icon: 'trophy', sort: 140, threshold: 300, lift: 'total' },
  { id: 'total_450', family: 'strength', name: '450 kg total club', description: totalDesc(450), icon: 'trophy', sort: 141, threshold: 450, lift: 'total' },
  { id: 'total_600', family: 'strength', name: '600 kg total club', description: totalDesc(600), icon: 'trophy', sort: 142, threshold: 600, lift: 'total' },
];

// ── Consistency (13) ────────────────────────────────────────────────────

/** "Log workouts on <n> different days." */
function sessionsDesc(threshold: number): string {
  return `Log workouts on ${threshold} different days.`;
}

/** "Hit your weekly session target <n> weeks in a row." */
function streakDesc(weeks: number): string {
  return `Hit your weekly session target ${weeks} weeks in a row.`;
}

const CONSISTENCY_BADGES: BadgeDef[] = [
  { id: 'day_one', family: 'consistency', name: 'Day one', description: 'Finish your very first workout.', icon: 'sessions', sort: 200, threshold: 1 },
  { id: 'sessions_10', family: 'consistency', name: '10 sessions', description: sessionsDesc(10), icon: 'sessions', sort: 201, threshold: 10 },
  { id: 'sessions_25', family: 'consistency', name: '25 sessions', description: sessionsDesc(25), icon: 'sessions', sort: 202, threshold: 25 },
  { id: 'sessions_50', family: 'consistency', name: '50 sessions', description: sessionsDesc(50), icon: 'sessions', sort: 203, threshold: 50 },
  { id: 'sessions_100', family: 'consistency', name: '100 sessions', description: sessionsDesc(100), icon: 'sessions', sort: 204, threshold: 100 },
  { id: 'sessions_250', family: 'consistency', name: '250 sessions', description: sessionsDesc(250), icon: 'sessions', sort: 205, threshold: 250 },
  { id: 'sessions_500', family: 'consistency', name: '500 sessions', description: sessionsDesc(500), icon: 'sessions', sort: 206, threshold: 500 },
  { id: 'streak_4w', family: 'consistency', name: '4-week streak', description: streakDesc(4), icon: 'flame', sort: 210, threshold: 4 },
  { id: 'streak_8w', family: 'consistency', name: '8-week streak', description: streakDesc(8), icon: 'flame', sort: 211, threshold: 8 },
  { id: 'streak_12w', family: 'consistency', name: '12-week streak', description: streakDesc(12), icon: 'flame', sort: 212, threshold: 12 },
  { id: 'streak_26w', family: 'consistency', name: '26-week streak', description: streakDesc(26), icon: 'flame', sort: 213, threshold: 26 },
  { id: 'streak_52w', family: 'consistency', name: '52-week streak', description: streakDesc(52), icon: 'flame', sort: 214, threshold: 52 },
  { id: 'comeback', family: 'consistency', name: 'Comeback', description: 'Return to training after a break of two weeks or more. Everyone stumbles — champions come back.', icon: 'comeback', sort: 220 },
];

// ── Mileage (5) — lifetime tonnage in kg ────────────────────────────────

/** "Move <label> of total volume across all your ranked sets." */
function tonnageDesc(label: string): string {
  return `Move ${label} of total volume (weight × reps) across all your ranked sets.`;
}

const MILEAGE_BADGES: BadgeDef[] = [
  { id: 'tonnage_10k', family: 'mileage', name: '10,000 kg lifted', description: tonnageDesc('10,000 kg'), icon: 'tonnage', sort: 300, threshold: 10_000 },
  { id: 'tonnage_50k', family: 'mileage', name: '50,000 kg lifted', description: tonnageDesc('50,000 kg'), icon: 'tonnage', sort: 301, threshold: 50_000 },
  { id: 'tonnage_100k', family: 'mileage', name: '100,000 kg lifted', description: tonnageDesc('100,000 kg'), icon: 'tonnage', sort: 302, threshold: 100_000 },
  { id: 'tonnage_500k', family: 'mileage', name: '500,000 kg lifted', description: tonnageDesc('500,000 kg'), icon: 'tonnage', sort: 303, threshold: 500_000 },
  { id: 'tonnage_1m', family: 'mileage', name: '1,000,000 kg lifted', description: tonnageDesc('1,000,000 kg'), icon: 'tonnage', sort: 304, threshold: 1_000_000 },
];

// ── Records (3) ─────────────────────────────────────────────────────────

const RECORDS_BADGES: BadgeDef[] = [
  { id: 'pr_first', family: 'records', name: 'First PR', description: 'Beat your previous best on any exercise for the first time.', icon: 'star', sort: 400, threshold: 1 },
  { id: 'pr_25', family: 'records', name: '25 PRs', description: 'Set 25 personal records across your exercises.', icon: 'star', sort: 401, threshold: 25 },
  { id: 'pr_100', family: 'records', name: '100 PRs', description: 'Set 100 personal records across your exercises.', icon: 'star', sort: 402, threshold: 100 },
];

// ── Coach & crew (4) ────────────────────────────────────────────────────

const CREW_BADGES: BadgeDef[] = [
  { id: 'checkin_first', family: 'crew', name: 'First check-in', description: 'Send your coach your first weekly check-in.', icon: 'clipboard', sort: 500, threshold: 1 },
  { id: 'checkin_10', family: 'crew', name: '10 check-ins', description: 'Check in with your coach in 10 different weeks.', icon: 'clipboard', sort: 501, threshold: 10 },
  { id: 'checkin_25', family: 'crew', name: '25 check-ins', description: 'Check in with your coach in 25 different weeks.', icon: 'clipboard', sort: 502, threshold: 25 },
  { id: 'coach_pick', family: 'crew', name: "Coach's pick", description: 'Awarded personally by your coach for standout effort this month.', icon: 'award', sort: 505 },
];

/** The full catalog — EXACTLY 42 badges (verified by a unit test). */
export const BADGE_CATALOG: readonly BadgeDef[] = [
  ...STRENGTH_BADGES,
  ...CONSISTENCY_BADGES,
  ...MILEAGE_BADGES,
  ...RECORDS_BADGES,
  ...CREW_BADGES,
];

/** Strength-club badge ids — used to filter the coach verification queue. */
export const STRENGTH_BADGE_IDS: readonly string[] = STRENGTH_BADGES.map((b) => b.id);

/** Badges awarded by an EVENT elsewhere, not by this file's pure threshold pass. */
const EVENT_DRIVEN_BADGE_IDS = new Set(['coach_pick']);

// ── Canonical lift matching ─────────────────────────────────────────────

const BENCH_RE = /bench press/i;
// Matches "squat", "barbell squat", "front squat", etc., but not compound
// variants that aren't the classic back-squat family (kept simple per spec).
const SQUAT_RE = /squat/i;
// All deadlift variants EXCEPT Romanian / stiff-leg (those train differently
// and shouldn't count toward the deadlift strength club).
const DEADLIFT_RE = /deadlift/i;
const DEADLIFT_EXCLUDE_RE = /romanian|stiff/i;
const OHP_RE = /overhead press|military press/i;

/**
 * Canonical big-lift family for an exercise, or null if it isn't one of the
 * four tracked lifts. Matched on exerciseName (case-insensitive); exerciseId
 * is accepted for future id-based matching but unused today.
 */
export function canonicalLift(
  _exerciseId: string,
  exerciseName: string,
): 'bench' | 'squat' | 'deadlift' | 'ohp' | null {
  const name = exerciseName.toLowerCase();
  if (BENCH_RE.test(name)) return 'bench';
  if (DEADLIFT_RE.test(name) && !DEADLIFT_EXCLUDE_RE.test(name)) return 'deadlift';
  if (SQUAT_RE.test(name)) return 'squat';
  if (OHP_RE.test(name)) return 'ohp';
  return null;
}

export interface BadgeComputeInput {
  /** Best e1RM per lift, from RANKED workouts only, kg. */
  bestE1RmByLift: Partial<Record<'bench' | 'squat' | 'deadlift' | 'ohp', number>>;
  lifetimeSessionDays: number;
  lifetimeTonnageKg: number;
  prCount: number;
  streakWeeksBest: number;
  /** Distinct session-day isos from ALL finished workouts (ranked + unranked — day_one/comeback use all). */
  sessionDayIsos: readonly string[];
  checkInCount: number;
  /** Legacy — the buddy badges are retired and nothing here reads it; kept so
   * server callers that still compute it for legacy accounts keep compiling. */
  hasBuddy: boolean;
}

/** Total (best S+B+D e1RM) from the per-lift bests, or null if any of the three is missing. */
function bestTotal(bestE1RmByLift: BadgeComputeInput['bestE1RmByLift']): number | null {
  const { bench, squat, deadlift } = bestE1RmByLift;
  if (bench === undefined || squat === undefined || deadlift === undefined) return null;
  return bench + squat + deadlift;
}

/**
 * True when there's ANY finished-workout gap of >= 14 days between two
 * consecutive session-days, i.e. the user came back from a long break at
 * some point in their history. A comeback is a one-time historical event, so
 * any qualifying gap (not just the most recent one) earns the badge — this
 * survives batched offline syncs where several post-break sessions land in a
 * single engine run and the trailing gap is short.
 */
function hasComeback(sessionDayIsos: readonly string[]): boolean {
  const sorted = [...new Set(sessionDayIsos)].sort();
  if (sorted.length < 2) return false;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const gapDays = Math.round(
      (new Date(`${curr}T00:00:00Z`).getTime() - new Date(`${prev}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (gapDays >= 14) return true;
  }
  return false;
}

/**
 * Pure threshold evaluation of the badge catalog against a snapshot of the
 * user's stats. Returns EVERY badge id currently earned (idempotent — the
 * caller diffs against already-awarded rows). Excludes coach_pick and
 * challenge:* — those are awarded by their own event-driven code paths.
 */
/**
 * Snapshot of the caller's own stats used to show progress bars on LOCKED
 * badges (personal-only surface — never shown for anyone else). Deliberately
 * a subset of BadgeComputeInput: everything derivable server-side without
 * shipping raw session history to the badges screen.
 */
export interface BadgeProgressStats {
  bestE1RmByLift: Partial<Record<'bench' | 'squat' | 'deadlift' | 'ohp', number>>;
  lifetimeSessionDays: number;
  lifetimeTonnageKg: number;
  prCount: number;
  streakWeeksBest: number;
  checkInCount: number;
  /** Legacy — see BadgeComputeInput.hasBuddy. */
  hasBuddy: boolean;
}

export type BadgeProgressUnit = 'kg' | 'sessions' | 'weeks' | 'prs' | 'check-ins';

export interface BadgeProgress {
  /** Raw current value — may exceed target once earned; clamp in the UI. */
  current: number;
  target: number;
  unit: BadgeProgressUnit;
}

/**
 * Progress toward one badge, or null for badges with no meaningful scalar
 * progress (comeback, coach_pick, challenge:* — event-shaped,
 * they happen rather than accumulate). Pure and threshold-consistent with
 * computeEarnedBadgeIds: current >= target exactly when the badge is earned,
 * with one deliberate exception — the `total` club shows the PARTIAL sum of
 * whichever big-three bests exist (more informative as a progress bar), while
 * the award itself still requires all three lifts to be present.
 */
export function badgeProgress(badge: BadgeDef, stats: BadgeProgressStats): BadgeProgress | null {
  const target = badge.threshold;

  switch (badge.family) {
    case 'strength': {
      if (target === undefined) return null;
      if (badge.lift === 'total') {
        const { bench, squat, deadlift } = stats.bestE1RmByLift;
        return { current: (bench ?? 0) + (squat ?? 0) + (deadlift ?? 0), target, unit: 'kg' };
      }
      if (badge.lift) {
        return { current: stats.bestE1RmByLift[badge.lift] ?? 0, target, unit: 'kg' };
      }
      return null;
    }
    case 'consistency': {
      if (badge.id === 'comeback') return null;
      if (badge.id.startsWith('streak_')) {
        return target === undefined ? null : { current: stats.streakWeeksBest, target, unit: 'weeks' };
      }
      // day_one + sessions_* — lifetime distinct session-days.
      return target === undefined
        ? null
        : { current: stats.lifetimeSessionDays, target, unit: 'sessions' };
    }
    case 'mileage': {
      return target === undefined ? null : { current: stats.lifetimeTonnageKg, target, unit: 'kg' };
    }
    case 'records': {
      return target === undefined ? null : { current: stats.prCount, target, unit: 'prs' };
    }
    case 'crew': {
      if (badge.id.startsWith('checkin_')) {
        return target === undefined
          ? null
          : { current: stats.checkInCount, target, unit: 'check-ins' };
      }
      return null; // coach_pick / challenge extras — event-driven
    }
  }
}

// ── Medal tiers (presentation metadata, derived purely from the catalog) ──

/**
 * Metal tier for a strength-club badge, derived from its rung on the lift's
 * ladder: 3-rung ladders (bench, ohp, total) run bronze → silver → gold;
 * 4-rung ladders (squat, deadlift) top out at elite — the accent-red metal,
 * same ramp names as the earned Rank ladder. Null for every non-strength
 * badge (they render as the red enamel medal, keeping metal scarce).
 */
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'elite';

const THREE_RUNG_TIERS: readonly BadgeTier[] = ['bronze', 'silver', 'gold'];
const FOUR_RUNG_TIERS: readonly BadgeTier[] = ['bronze', 'silver', 'gold', 'elite'];

export function badgeTier(badge: BadgeDef): BadgeTier | null {
  if (badge.family !== 'strength' || badge.lift === undefined) return null;
  const ladder = BADGE_CATALOG.filter((b) => b.family === 'strength' && b.lift === badge.lift);
  const rung = ladder.findIndex((b) => b.id === badge.id);
  if (rung === -1) return null;
  const tiers = ladder.length >= 4 ? FOUR_RUNG_TIERS : THREE_RUNG_TIERS;
  return tiers[rung] ?? null;
}

export function computeEarnedBadgeIds(input: BadgeComputeInput): string[] {
  const earned: string[] = [];

  for (const badge of BADGE_CATALOG) {
    if (EVENT_DRIVEN_BADGE_IDS.has(badge.id)) continue;

    switch (badge.family) {
      case 'strength': {
        if (badge.lift === 'total') {
          const total = bestTotal(input.bestE1RmByLift);
          if (total !== null && total >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        } else if (badge.lift) {
          const best = input.bestE1RmByLift[badge.lift];
          if (best !== undefined && best >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        }
        break;
      }
      case 'consistency': {
        if (badge.id === 'day_one') {
          if (input.sessionDayIsos.length >= 1) earned.push(badge.id);
        } else if (badge.id === 'comeback') {
          if (hasComeback(input.sessionDayIsos)) earned.push(badge.id);
        } else if (badge.id.startsWith('sessions_')) {
          if (input.lifetimeSessionDays >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        } else if (badge.id.startsWith('streak_')) {
          if (input.streakWeeksBest >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        }
        break;
      }
      case 'mileage': {
        if (input.lifetimeTonnageKg >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        break;
      }
      case 'records': {
        if (input.prCount >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        break;
      }
      case 'crew': {
        if (badge.id === 'checkin_first' || badge.id === 'checkin_10' || badge.id === 'checkin_25') {
          if (input.checkInCount >= (badge.threshold ?? Infinity)) earned.push(badge.id);
        }
        break;
      }
    }
  }

  return earned;
}
