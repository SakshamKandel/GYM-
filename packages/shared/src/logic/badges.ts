/**
 * Badge catalog + award computation — pure data + pure logic, unit-tested
 * (CLAUDE.md rule 10). Strength-club badges always start 'logged'; only a
 * coach can upgrade one to 'verified' (server-side, not here).
 *
 * Catalog is EXACTLY 44 badges at launch:
 *   strength (17) + consistency (13) + mileage (5) + records (3) + crew (6)
 * Challenge badges (`challenge:<id>`) and the two event-driven crew badges
 * (buddy_quest, coach_pick) are awarded server-side outside this pure
 * threshold evaluator — see computeEarnedBadgeIds's doc for what it covers.
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
  icon: BadgeIconKey;
  sort: number;
  threshold?: number;
  lift?: CanonicalLift;
}

// ── Strength clubs (17) — e1RM thresholds in kg, canonical weight ──────────

const STRENGTH_BADGES: BadgeDef[] = [
  { id: 'bench_60', family: 'strength', name: '60 kg bench club', icon: 'barbell', sort: 100, threshold: 60, lift: 'bench' },
  { id: 'bench_100', family: 'strength', name: '100 kg bench club', icon: 'barbell', sort: 101, threshold: 100, lift: 'bench' },
  { id: 'bench_140', family: 'strength', name: '140 kg bench club', icon: 'barbell', sort: 102, threshold: 140, lift: 'bench' },
  { id: 'squat_60', family: 'strength', name: '60 kg squat club', icon: 'barbell', sort: 110, threshold: 60, lift: 'squat' },
  { id: 'squat_100', family: 'strength', name: '100 kg squat club', icon: 'barbell', sort: 111, threshold: 100, lift: 'squat' },
  { id: 'squat_140', family: 'strength', name: '140 kg squat club', icon: 'barbell', sort: 112, threshold: 140, lift: 'squat' },
  { id: 'squat_180', family: 'strength', name: '180 kg squat club', icon: 'barbell', sort: 113, threshold: 180, lift: 'squat' },
  { id: 'deadlift_100', family: 'strength', name: '100 kg deadlift club', icon: 'barbell', sort: 120, threshold: 100, lift: 'deadlift' },
  { id: 'deadlift_140', family: 'strength', name: '140 kg deadlift club', icon: 'barbell', sort: 121, threshold: 140, lift: 'deadlift' },
  { id: 'deadlift_180', family: 'strength', name: '180 kg deadlift club', icon: 'barbell', sort: 122, threshold: 180, lift: 'deadlift' },
  { id: 'deadlift_220', family: 'strength', name: '220 kg deadlift club', icon: 'barbell', sort: 123, threshold: 220, lift: 'deadlift' },
  { id: 'ohp_40', family: 'strength', name: '40 kg overhead press club', icon: 'barbell', sort: 130, threshold: 40, lift: 'ohp' },
  { id: 'ohp_60', family: 'strength', name: '60 kg overhead press club', icon: 'barbell', sort: 131, threshold: 60, lift: 'ohp' },
  { id: 'ohp_80', family: 'strength', name: '80 kg overhead press club', icon: 'barbell', sort: 132, threshold: 80, lift: 'ohp' },
  { id: 'total_300', family: 'strength', name: '300 kg total club', icon: 'trophy', sort: 140, threshold: 300, lift: 'total' },
  { id: 'total_450', family: 'strength', name: '450 kg total club', icon: 'trophy', sort: 141, threshold: 450, lift: 'total' },
  { id: 'total_600', family: 'strength', name: '600 kg total club', icon: 'trophy', sort: 142, threshold: 600, lift: 'total' },
];

// ── Consistency (13) ────────────────────────────────────────────────────

const CONSISTENCY_BADGES: BadgeDef[] = [
  { id: 'day_one', family: 'consistency', name: 'Day one', icon: 'sessions', sort: 200, threshold: 1 },
  { id: 'sessions_10', family: 'consistency', name: '10 sessions', icon: 'sessions', sort: 201, threshold: 10 },
  { id: 'sessions_25', family: 'consistency', name: '25 sessions', icon: 'sessions', sort: 202, threshold: 25 },
  { id: 'sessions_50', family: 'consistency', name: '50 sessions', icon: 'sessions', sort: 203, threshold: 50 },
  { id: 'sessions_100', family: 'consistency', name: '100 sessions', icon: 'sessions', sort: 204, threshold: 100 },
  { id: 'sessions_250', family: 'consistency', name: '250 sessions', icon: 'sessions', sort: 205, threshold: 250 },
  { id: 'sessions_500', family: 'consistency', name: '500 sessions', icon: 'sessions', sort: 206, threshold: 500 },
  { id: 'streak_4w', family: 'consistency', name: '4-week streak', icon: 'flame', sort: 210, threshold: 4 },
  { id: 'streak_8w', family: 'consistency', name: '8-week streak', icon: 'flame', sort: 211, threshold: 8 },
  { id: 'streak_12w', family: 'consistency', name: '12-week streak', icon: 'flame', sort: 212, threshold: 12 },
  { id: 'streak_26w', family: 'consistency', name: '26-week streak', icon: 'flame', sort: 213, threshold: 26 },
  { id: 'streak_52w', family: 'consistency', name: '52-week streak', icon: 'flame', sort: 214, threshold: 52 },
  { id: 'comeback', family: 'consistency', name: 'Comeback', icon: 'comeback', sort: 220 },
];

// ── Mileage (5) — lifetime tonnage in kg ────────────────────────────────

const MILEAGE_BADGES: BadgeDef[] = [
  { id: 'tonnage_10k', family: 'mileage', name: '10,000 kg lifted', icon: 'tonnage', sort: 300, threshold: 10_000 },
  { id: 'tonnage_50k', family: 'mileage', name: '50,000 kg lifted', icon: 'tonnage', sort: 301, threshold: 50_000 },
  { id: 'tonnage_100k', family: 'mileage', name: '100,000 kg lifted', icon: 'tonnage', sort: 302, threshold: 100_000 },
  { id: 'tonnage_500k', family: 'mileage', name: '500,000 kg lifted', icon: 'tonnage', sort: 303, threshold: 500_000 },
  { id: 'tonnage_1m', family: 'mileage', name: '1,000,000 kg lifted', icon: 'tonnage', sort: 304, threshold: 1_000_000 },
];

// ── Records (3) ─────────────────────────────────────────────────────────

const RECORDS_BADGES: BadgeDef[] = [
  { id: 'pr_first', family: 'records', name: 'First PR', icon: 'star', sort: 400, threshold: 1 },
  { id: 'pr_25', family: 'records', name: '25 PRs', icon: 'star', sort: 401, threshold: 25 },
  { id: 'pr_100', family: 'records', name: '100 PRs', icon: 'star', sort: 402, threshold: 100 },
];

// ── Coach & crew (6) ────────────────────────────────────────────────────

const CREW_BADGES: BadgeDef[] = [
  { id: 'checkin_first', family: 'crew', name: 'First check-in', icon: 'clipboard', sort: 500, threshold: 1 },
  { id: 'checkin_10', family: 'crew', name: '10 check-ins', icon: 'clipboard', sort: 501, threshold: 10 },
  { id: 'checkin_25', family: 'crew', name: '25 check-ins', icon: 'clipboard', sort: 502, threshold: 25 },
  { id: 'buddy_first', family: 'crew', name: 'First buddy', icon: 'buddies', sort: 503 },
  { id: 'buddy_quest', family: 'crew', name: 'Buddy quest', icon: 'buddies', sort: 504 },
  { id: 'coach_pick', family: 'crew', name: "Coach's pick", icon: 'award', sort: 505 },
];

/** The full launch catalog — EXACTLY 44 badges (verified by a unit test). */
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
const EVENT_DRIVEN_BADGE_IDS = new Set(['buddy_quest', 'coach_pick']);

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
  hasBuddy: boolean;
}

/** Total (best S+B+D e1RM) from the per-lift bests, or null if any of the three is missing. */
function bestTotal(bestE1RmByLift: BadgeComputeInput['bestE1RmByLift']): number | null {
  const { bench, squat, deadlift } = bestE1RmByLift;
  if (bench === undefined || squat === undefined || deadlift === undefined) return null;
  return bench + squat + deadlift;
}

/**
 * True when there's a finished-workout gap of >= 14 days immediately before
 * the MOST RECENT session-day in the given (unsorted) list, i.e. the user
 * just came back from a long break.
 */
function hasComeback(sessionDayIsos: readonly string[]): boolean {
  if (sessionDayIsos.length < 2) return false;
  const sorted = [...new Set(sessionDayIsos)].sort();
  const last = sorted[sorted.length - 1]!;
  const prev = sorted[sorted.length - 2]!;
  const gapDays = Math.round(
    (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${prev}T00:00:00Z`).getTime()) / 86_400_000,
  );
  return gapDays >= 14;
}

/**
 * Pure threshold evaluation of the badge catalog against a snapshot of the
 * user's stats. Returns EVERY badge id currently earned (idempotent — the
 * caller diffs against already-awarded rows). Excludes buddy_quest, coach_pick,
 * and challenge:* — those are awarded by their own event-driven code paths.
 */
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
        } else if (badge.id === 'buddy_first') {
          if (input.hasBuddy) earned.push(badge.id);
        }
        break;
      }
    }
  }

  return earned;
}
