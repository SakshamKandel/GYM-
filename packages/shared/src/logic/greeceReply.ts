import type { GoalType, Tier } from '../types';

/**
 * The "Greece reply" — the retention driver behind the weekly check-in.
 *
 * After the Sunday 3-tap check-in runs the GM adaptive engine, this composes a
 * TEMPLATED-BUT-PERSONAL written reply in Greece Maharjan's coaching voice that
 * references the user's REAL numbers (their PR, their volume, the calorie nudge,
 * their weight trend vs their goal). Pure logic — no I/O, no network (CLAUDE.md
 * rule 10). Tier controls richness, never accuracy.
 *
 *  - Silver: headline + 1 line + signoff (short auto reply).
 *  - Gold:   headline + up to 3 lines (richer multi-line review).
 *  - Elite:  same as Gold but signed "— Greece", plus one line that acknowledges
 *            the 1:1 relationship — framed as an actual message from the coach.
 */

/** The three Sunday taps. 1 = low/none/tough, 2 = ok, 3 = great/lots/strong. */
export interface CheckInSignals {
  energy: 1 | 2 | 3;
  soreness: 1 | 2 | 3;
  weekFeel: 1 | 2 | 3;
}

/** Real numbers pulled from the repo + the adaptive engine at check-in time. */
export interface CheckInFacts {
  goal: GoalType;
  tier: Tier;
  /** Total training volume (kg × reps) over the check-in week. */
  weeklyVolumeKg: number;
  /** How many PRs the user set this week. */
  prCount: number;
  /** The standout lift this week, if any. */
  topPr?: { exerciseName: string; weightKg: number; reps: number };
  /** Smoothed bodyweight change per week, kg (signed; negative = losing). */
  trendRatePerWeekKg: number;
  /** newKcal − previous target from gmWeeklyAdjustment (signed; 0 = held). */
  kcalDeltaFromCheckIn: number;
  /** High soreness + high volume → the engine suggests backing off. */
  deloadSuggested: boolean;
}

export interface GreeceReply {
  /** One-line headline — the title of the coach message. */
  headline: string;
  /** 1–3 body lines referencing the real facts, in coach voice. */
  lines: string[];
  /** The closing line: "— The GM Method" for silver/gold, "— Greece" for elite. */
  signoff: string;
}

/** Volume above this (kg) reads as a genuinely big training week. */
const BIG_VOLUME_KG = 10000;

/** Rounds the kcal delta into readable coach speech ("+150", "−75"). */
function deltaPhrase(delta: number): string {
  const rounded = Math.round(delta);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** The headline reacts first to how the week felt, then to energy. */
function buildHeadline(signals: CheckInSignals): string {
  if (signals.weekFeel === 3) return 'Strong week. That is the standard now.';
  if (signals.weekFeel === 1) {
    return signals.energy === 1
      ? 'Rough week — let us reset and go again.'
      : 'A tough week still counts. You showed up.';
  }
  return signals.energy >= 2
    ? 'Solid week in the books. Onward.'
    : 'Steady week. Consistency is the whole game.';
}

/** Plain-language read on the weight trend relative to the goal. */
function trendLine(facts: CheckInFacts): string | null {
  const rate = facts.trendRatePerWeekKg;
  const magnitude = Math.abs(Math.round(rate * 10) / 10);
  if (magnitude < 0.05) {
    return facts.goal === 'muscle'
      ? 'The scale held flat — we want it creeping up, so eat.'
      : 'The scale held flat this week — steady is fine.';
  }
  const losing = rate < 0;
  switch (facts.goal) {
    case 'fat_loss':
      return losing
        ? `Down ${magnitude} kg on the trend — exactly the direction we want.`
        : `Trend ticked up ${magnitude} kg — nothing to panic about, we adjust.`;
    case 'muscle':
      return losing
        ? `Trend dipped ${magnitude} kg — we need to feed the growth.`
        : `Up ${magnitude} kg on the trend — building, right on plan.`;
    case 'strength':
      return losing
        ? `Down ${magnitude} kg — we protect the fuel that drives your lifts.`
        : `Up ${magnitude} kg — the scale is backing your strength work.`;
  }
}

/**
 * Compose Greece's reply from the taps and the real facts.
 * Body-line priority (highest first, so the tier line-budget keeps what matters):
 *   1. the standout win (PR / volume) — the emotional hook,
 *   2. the calorie nudge — the exact number the engine chose,
 *   3. triggered recovery guidance (deload / low energy) — actionable, so it
 *      outranks the trend readout when soreness or fatigue is high,
 *   4. the weight trend vs the goal — the fallback context line.
 */
export function greeceReply(signals: CheckInSignals, facts: CheckInFacts): GreeceReply {
  const headline = buildHeadline(signals);
  const candidates: string[] = [];

  // 1) The standout win — the emotional hook.
  if (facts.topPr !== undefined) {
    candidates.push(
      `You added weight to your ${facts.topPr.exerciseName} — that's the GM method working.`,
    );
  } else if (facts.prCount > 0) {
    candidates.push(`${facts.prCount} PRs this week. The work is showing.`);
  } else if (facts.weeklyVolumeKg >= BIG_VOLUME_KG) {
    candidates.push('Big volume week — no PR needed, that tonnage is the win.');
  }

  // 2) The calorie nudge — reference the exact number the engine chose.
  if (facts.kcalDeltaFromCheckIn !== 0) {
    candidates.push(
      `I nudged your calories ${deltaPhrase(facts.kcalDeltaFromCheckIn)} to match your trend.`,
    );
  } else {
    candidates.push('Calories stay put — you are right in the band.');
  }

  // 3) Recovery guidance when it's actually triggered — deload wins over
  //    generic low-energy advice. Ranked above the trend line so it survives
  //    the tier truncation on a heavy, sore week.
  if (facts.deloadSuggested || (signals.soreness === 3 && facts.weeklyVolumeKg >= BIG_VOLUME_KG)) {
    candidates.push('Soreness is high on heavy volume — take a lighter week, then attack.');
  } else if (signals.energy === 1) {
    candidates.push('Low energy — prioritise sleep and protein before the next block.');
  } else if (signals.soreness === 3) {
    candidates.push('Legs and back need recovery — add a mobility day this week.');
  }

  // 4) The weight trend vs the goal — context fallback.
  const trend = trendLine(facts);
  if (trend !== null) candidates.push(trend);

  const isElite = facts.tier === 'elite';
  const isSilver = facts.tier === 'silver';

  const lines: string[] = [];
  if (isSilver) {
    // Silver: exactly one line — lead with the strongest candidate.
    if (candidates[0] !== undefined) lines.push(candidates[0]);
  } else {
    // Gold & Elite: up to 3 lines.
    lines.push(...candidates.slice(0, 3));
    // Elite gets the 1:1 acknowledgement as its own personal line.
    if (isElite) {
      if (lines.length >= 3) lines[2] = 'I have got eyes on your numbers personally this week.';
      else lines.push('I have got eyes on your numbers personally this week.');
    }
  }

  const signoff = isElite ? '— Greece' : '— The GM Method';
  return { headline, lines, signoff };
}
