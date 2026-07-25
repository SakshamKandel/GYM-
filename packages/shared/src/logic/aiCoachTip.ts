import { z } from 'zod';

/**
 * The coach tip is the ONLY AI surface in the app (Home + Progress). This
 * module owns the whole contract for it:
 *
 *  1. A CLOSED request payload. The client sends a `kind` plus a small bag of
 *     validated numbers and enums. It sends NO prose, so no member text ever
 *     reaches the model and there is nothing to inject into. The server owns
 *     the system prompt and composes the user turn from these values.
 *  2. The fixed safety copy. When a stored goal weight implies a body mass
 *     index outside a healthy range for the stored height, the server answers
 *     with one of these exact strings and never calls the model. Keeping them
 *     here means they are unit-tested and can never be model-generated.
 *  3. The bound + clean-up applied to model output before anyone reads it.
 *
 * Every numeric field is nullable and `.catch()`-guarded: a device with an odd
 * local value degrades to "we do not know that number" instead of failing the
 * whole request, and the server simply leaves that fact out of the prompt.
 */

// ── Request ──────────────────────────────────────────────────────

/** Which card asked. Each kind has its own server-owned system prompt. */
export const AI_TIP_KINDS = ['home', 'weight'] as const;
export type AiTipKind = (typeof AI_TIP_KINDS)[number];

/** A measurement we may or may not have, bounded to a sane physical range. */
const measure = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable().catch(null);

/** A tally we may or may not have (whole, never negative). */
const tally = (max: number) => z.number().int().min(0).max(max).nullable().catch(null);

/**
 * Everything the model is ever told about a member. Training and body numbers
 * only. Nothing here is free text, and this list must not grow to include
 * coach notes, messages, food names, photos or anything else a member wrote.
 */
export const aiTipContextSchema = z.object({
  /** What the member said they are training for. */
  goalType: z.enum(['fat_loss', 'muscle', 'strength']).nullable().catch(null),
  /** So the reply speaks in the member's own unit. */
  unitPref: z.enum(['kg', 'lb']).catch('kg'),
  /** Smoothed trend weight, not this morning's scale number. */
  bodyweightKg: measure(20, 400),
  goalWeightKg: measure(20, 400),
  /** Needed for the goal safety check below. */
  heightCm: measure(90, 260),
  trendDirection: z.enum(['up', 'down', 'flat']).nullable().catch(null),
  ratePerWeekKg: measure(-10, 10),
  sessionsThisWeek: tally(50),
  streakWeeks: tally(520),
  daysSinceLastSession: tally(3650),
  /** Total load lifted this week, kg. */
  weekVolumeKg: measure(0, 1_000_000),
  personalBestsLast30Days: tally(500),
  trainedToday: z.boolean().nullable().catch(null),
});

export type AiTipContext = z.infer<typeof aiTipContextSchema>;

/** Highest variety counter we will honour; past this it wraps client-side. */
export const AI_TIP_MAX_VARIETY = 999;

export const aiTipRequestSchema = z.object({
  kind: z.enum(AI_TIP_KINDS),
  /**
   * Bumped every time the member taps "New tip". The server appends it to its
   * OWN prompt so a repeat ask reliably lands on a different angle. It rides
   * here as a plain number precisely so it cannot smuggle in instructions.
   */
  variety: z.number().int().min(0).max(AI_TIP_MAX_VARIETY).catch(0),
  context: aiTipContextSchema,
});

export type AiTipRequest = z.infer<typeof aiTipRequestSchema>;

/** What a screen builds; the hook adds `variety`. */
export type AiTipRequestInput = Omit<AiTipRequest, 'variety'>;

// ── Response ─────────────────────────────────────────────────────

/**
 * - `ok`             the model answered and the answer passed the clean-up.
 * - `safety`         fixed copy, written by us, no model call was made.
 * - `not_configured` no provider key on this deployment (an operator problem).
 * - `unavailable`    the provider failed, timed out, or said nothing usable.
 *
 * `not_configured` exists so a deployment that was never given a key is
 * distinguishable from a provider having a bad afternoon. Members see the same
 * quiet empty state either way.
 */
export const AI_TIP_STATUSES = ['ok', 'safety', 'not_configured', 'unavailable'] as const;
export type AiTipStatus = (typeof AI_TIP_STATUSES)[number];

/**
 * `text` stays first and keeps its old meaning (string to show, or null) so
 * clients shipped before `status` existed carry on working unchanged.
 */
export const aiTipResponseSchema = z.object({
  text: z.string().nullable(),
  status: z.enum(AI_TIP_STATUSES).optional().catch(undefined),
});

export type AiTipResponse = z.infer<typeof aiTipResponseSchema>;

/**
 * What the card should do. `fixed` marks copy we wrote ourselves, so the screen
 * can drop the "written by an AI coach" caption and not claim something untrue.
 */
export type AiTipOutcome =
  | { kind: 'tip'; text: string }
  | { kind: 'fixed'; text: string }
  | { kind: 'unavailable' };

/**
 * Map a parsed response to what the card shows, re-applying the text bound on
 * the way in. Belt and braces: the server already cleans its output, and this
 * keeps an old or misbehaving server from putting an essay on a card.
 */
export function aiTipOutcome(response: AiTipResponse): AiTipOutcome {
  const text = sanitizeAiTipText(response.text);
  if (text === null) return { kind: 'unavailable' };
  if (response.status === 'safety') return { kind: 'fixed', text };
  if (response.status === 'not_configured' || response.status === 'unavailable') {
    return { kind: 'unavailable' };
  }
  // `status` absent = a server from before this field existed. Text won.
  return { kind: 'tip', text };
}

// ── Goal safety ──────────────────────────────────────────────────

/**
 * The tip surface invites weight-loss coaching, so it must not coach towards a
 * goal weight that is out of a healthy range for the member's height.
 *
 * Low bound: 18.5 is the recognised line below which a body mass index is
 * classed as underweight. High bound: 40 is the severe-obesity line, and it
 * only trips when the goal is ABOVE the member's current weight, because a
 * member at 45 aiming for 38 is moving in a healthy direction and should not
 * be lectured for it.
 */
export const AI_TIP_SAFE_GOAL_BMI_MIN = 18.5;
export const AI_TIP_SAFE_GOAL_BMI_MAX = 40;

/**
 * Fixed refusal copy. Warm, short, never clinical, and never generated. The
 * member keeps every other feature; we are only declining to coach the number.
 */
export const AI_TIP_GOAL_TOO_LOW_MESSAGE =
  'Your goal weight sits below a healthy range for your height, so this is one to talk through with a doctor or a dietitian first. They can help you pick a number that keeps your training strong. Everything else in the app works as normal.';

export const AI_TIP_GOAL_TOO_HIGH_MESSAGE =
  'Your goal weight sits well above a healthy range for your height, so a doctor or a dietitian is the right person to help you plan it. They can set a pace that looks after you along the way. Everything else in the app works as normal.';

export type AiTipSafetyReason = 'goal_below_healthy' | 'goal_above_healthy';

export interface AiTipSafetyVerdict {
  /** false = answer with `message` and do not call the model. */
  ok: boolean;
  reason: AiTipSafetyReason | null;
  /** The exact string to return. Null when `ok`. */
  message: string | null;
  /** Body mass index the goal weight implies, rounded to one decimal. */
  goalBmi: number | null;
}

/** Body mass index, one decimal. Null when either input is missing or absurd. */
export function bmiFrom(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm)) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;
  const metres = heightCm / 100;
  const bmi = weightKg / (metres * metres);
  if (!Number.isFinite(bmi)) return null;
  return Math.round(bmi * 10) / 10;
}

/**
 * Decide whether we are willing to coach towards this goal weight. Missing
 * height or missing goal = no opinion, because a guess would either refuse
 * someone unfairly or wave through something we cannot judge.
 */
export function checkAiTipGoalSafety(
  context: Pick<AiTipContext, 'goalWeightKg' | 'heightCm' | 'bodyweightKg'>,
): AiTipSafetyVerdict {
  const goalBmi = bmiFrom(context.goalWeightKg, context.heightCm);
  if (goalBmi === null) return { ok: true, reason: null, message: null, goalBmi: null };

  if (goalBmi < AI_TIP_SAFE_GOAL_BMI_MIN) {
    return {
      ok: false,
      reason: 'goal_below_healthy',
      message: AI_TIP_GOAL_TOO_LOW_MESSAGE,
      goalBmi,
    };
  }

  const gaining =
    context.bodyweightKg === null ||
    (context.goalWeightKg !== null && context.goalWeightKg > context.bodyweightKg);
  if (goalBmi > AI_TIP_SAFE_GOAL_BMI_MAX && gaining) {
    return {
      ok: false,
      reason: 'goal_above_healthy',
      message: AI_TIP_GOAL_TOO_HIGH_MESSAGE,
      goalBmi,
    };
  }

  return { ok: true, reason: null, message: null, goalBmi };
}

// ── Model output clean-up ────────────────────────────────────────

/** Anything shorter than this is a stub, not a tip. */
export const AI_TIP_MIN_CHARS = 12;
/** Hard ceiling on what can reach a card. The prompt asks for ~35 words. */
export const AI_TIP_MAX_CHARS = 320;

/** Pictographs, symbol arrows and variation selectors. House style: no emoji. */
const PICTOGRAPH = /[\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{1F000}-\u{1FAFF}]/gu;
/** Markdown scaffolding a chat model sprinkles in out of habit. */
const MARKUP = /[*_`#>[\]]/g;
/** "Tip:", "Coach tip -", "Here's your tip:" and friends. */
const LEAD_IN = /^\s*(?:here(?:'|’)?s\s+(?:a|your)\s+)?(?:coach\s+)?tip\s*[:–—-]\s*/i;

/**
 * Make model output safe to put on a card: one paragraph, no emoji, no
 * markdown, no dashes used as punctuation, no shouting, and never longer than
 * the card was designed for. Returns null when nothing usable is left, which
 * the callers show as the quiet empty state.
 */
export function sanitizeAiTipText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  let text = raw
    .replace(PICTOGRAPH, ' ')
    .replace(MARKUP, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(LEAD_IN, '');

  // Drop wrapping quotes the model added around its own sentence.
  const first = text[0];
  const last = text[text.length - 1];
  if (
    text.length > 1 &&
    ((first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '“' && last === '”'))
  ) {
    text = text.slice(1, -1).trim();
  }

  text = text
    // A dash used as punctuation becomes a comma (house copy rule).
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    // No shouting on a card that shows up every day.
    .replace(/!+/g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > AI_TIP_MAX_CHARS) {
    const window = text.slice(0, AI_TIP_MAX_CHARS);
    const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '));
    if (lastStop >= AI_TIP_MAX_CHARS / 2) {
      text = window.slice(0, lastStop + 1).trim();
    } else {
      const lastSpace = window.lastIndexOf(' ');
      text = (lastSpace > 0 ? window.slice(0, lastSpace) : window).trim().replace(/[,;:]$/, '');
      if (!/[.?]$/.test(text)) text = `${text}.`;
    }
  }

  if (text.length < AI_TIP_MIN_CHARS) return null;
  if (!/[.?]$/.test(text)) text = `${text}.`;
  return text;
}
