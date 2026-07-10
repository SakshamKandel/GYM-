/**
 * Leaderboard presentation logic — pure data math, unit-tested (CLAUDE.md
 * rule 10). Everything here operates on session-day COUNTS only, mirroring
 * the design law that consistency boards never rank by kg, XP, or tier.
 *
 * Shared by the server routes (tie-aware positions) and the mobile screens
 * (ordinals, "sessions to catch up" hints, month countdown) so the two can
 * never drift apart.
 */

/** "1st" / "2nd" / "3rd" / "4th" … with the 11th/12th/13th exception. */
export function ordinalLabel(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Competition ("1224") ranking: each entry's position is 1 + the number of
 * entries with a STRICTLY greater count, so ties share a position and the
 * next distinct count skips ahead ([9,7,7,4] → [1,2,2,4]).
 *
 * Input order is preserved in the output (positions[i] belongs to counts[i]);
 * the input does NOT need to be pre-sorted.
 */
export function competitionPositions(counts: readonly number[]): number[] {
  const sorted = [...counts].sort((a, b) => b - a);
  const positionByCount = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    const count = sorted[i]!;
    if (!positionByCount.has(count)) positionByCount.set(count, i + 1);
  }
  return counts.map((c) => positionByCount.get(c)!);
}

export interface CatchUpHint {
  /** Session-days needed to TIE the nearest group above (always >= 1). */
  sessionsNeeded: number;
  /** That group's session-day count. */
  targetDays: number;
  /** That group's shared competition position. */
  targetPosition: number;
}

/**
 * The nearest rung above the caller: the SMALLEST session-day count strictly
 * greater than theirs among all ranked entries, with how many more
 * session-days it takes to tie it (tying already improves the caller's
 * competition position). Returns null when the caller is at/above everyone
 * (leading or tied for the lead) — there is nothing above to catch.
 */
export function catchUpHint(myDays: number, allDays: readonly number[]): CatchUpHint | null {
  let nearestAbove: number | null = null;
  for (const d of allDays) {
    if (d > myDays && (nearestAbove === null || d < nearestAbove)) nearestAbove = d;
  }
  if (nearestAbove === null) return null;
  let greater = 0;
  for (const d of allDays) if (d > nearestAbove) greater++;
  return {
    sessionsNeeded: nearestAbove - myDays,
    targetDays: nearestAbove,
    targetPosition: greater + 1,
  };
}

/**
 * Whole days remaining in `todayIso`'s month AFTER today (0 on the month's
 * last day). Pure calendar math on the ISO string — no timezone involved.
 */
export function daysLeftInMonth(todayIso: string): number {
  const [y, m, d] = todayIso.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return Math.max(0, lastDay - d);
}
