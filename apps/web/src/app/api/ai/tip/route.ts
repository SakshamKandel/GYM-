import {
  aiTipRequestSchema,
  checkAiTipGoalSafety,
  displayWeight,
  sanitizeAiTipText,
  unitLabel,
  type AiTipContext,
  type AiTipKind,
  type AiTipStatus,
} from '@gym/shared';
import { bearerToken, userForToken } from '@/lib/auth';
import { groqComplete, isGroqConfigured } from '@/lib/groq';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * The short coach tip on Home and on Progress. This is the only AI surface in
 * the product, and it is deliberately CLOSED:
 *
 *  - The request carries a `kind` plus a small bag of validated numbers and
 *    enums (packages/shared aiCoachTip.ts). No member prose is accepted, so
 *    there is no free text to inject with and nothing a member typed anywhere
 *    else in the app can reach the model.
 *  - Both the system prompt and the user turn are composed HERE, from those
 *    numbers. Earlier versions took a messages array and dropped the client's
 *    system turn, which meant the Progress card asked for weight coaching and
 *    got a random fitness fact back. Now each kind gets its own prompt.
 *  - A goal weight that implies an unhealthy body mass index for the stored
 *    height is answered with fixed copy from packages/shared, with NO model
 *    call at all.
 *
 * Generation runs with the server's GROQ_API_KEY so no key ships in the app.
 * Auth-gated, per-minute limited AND daily-quota limited, with a short output
 * cap, so it can neither be repurposed as an open LLM proxy nor run up a bill.
 */

/** 6/min catches a stuck client; 60/day is far above a real member's use. */
const PER_MINUTE_LIMIT = 6;
const PER_DAY_LIMIT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ~35 words. A little headroom so the last sentence can finish. */
const MAX_OUTPUT_TOKENS = 80;

/**
 * Below the app's own 10s request timeout on purpose: the server aborts first
 * and answers with a clean empty state, instead of the phone timing out on a
 * connection that is still open.
 */
const MODEL_TIMEOUT_MS = 7_000;

/**
 * Fixed, server-owned framing. One per card, because the two cards are asking
 * genuinely different questions. Rules are repeated in plain terms because the
 * model follows short concrete instructions better than a style guide.
 */
const SYSTEM_PROMPTS: Record<AiTipKind, string> = {
  home:
    'You are a warm, experienced gym coach speaking to one member you know well. ' +
    'Using only the numbers you are given, write ONE note of at most 35 words that names ' +
    'something real about how their week is going and gives them a single clear thing to do next. ' +
    'Be specific and practical. Sound like a person at the gym, not an app. ' +
    'Rules: second person, plain everyday words, no emoji, no exclamation marks, no dashes, ' +
    'no bullet points, no quotation marks, no headings, no sign-off. ' +
    'Do not list their numbers back at them. Do not invent any number you were not given. ' +
    'Do not give medical, injury or restrictive diet advice, and do not comment on how they look.',
  weight:
    'You are a warm, experienced gym coach speaking to one member about their weight trend. ' +
    'Using only the numbers you are given, write ONE note of at most 35 words that reads their ' +
    'trend honestly and gives a single practical step for the week ahead. ' +
    'Be kind about slow progress and never dramatic about a bad week. ' +
    'Rules: second person, plain everyday words, no emoji, no exclamation marks, no dashes, ' +
    'no bullet points, no quotation marks, no headings, no sign-off. ' +
    'Do not list their numbers back at them. Do not invent any number you were not given. ' +
    'Do not prescribe calories, do not give medical or restrictive diet advice, and do not ' +
    'comment on how they look.',
};

/** The one-line ask at the end of the user turn, per card. */
const ASKS: Record<AiTipKind, string> = {
  home: 'Write their note for today.',
  weight: 'Write their note about this weight trend.',
};

const GOAL_LABELS: Record<NonNullable<AiTipContext['goalType']>, string> = {
  fat_loss: 'losing fat',
  muscle: 'building muscle',
  strength: 'getting stronger',
};

const TREND_LABELS: Record<NonNullable<AiTipContext['trendDirection']>, string> = {
  up: 'going up',
  down: 'coming down',
  flat: 'holding steady',
};

/** One decimal, in the member's own unit, so the reply speaks their language. */
function weight(kg: number, context: AiTipContext): string {
  return `${displayWeight(kg, context.unitPref).toFixed(1)} ${unitLabel(context.unitPref)}`;
}

/**
 * The facts, one short sentence each. Anything we do not know is simply left
 * out, so the model never has to reason about a missing value (and can never
 * tell a member they did zero sessions when we just did not ask).
 */
function factLines(context: AiTipContext): string[] {
  const lines: string[] = [];

  if (context.goalType !== null) {
    lines.push(`They are training for ${GOAL_LABELS[context.goalType]}.`);
  }
  if (context.bodyweightKg !== null) {
    lines.push(`Bodyweight: ${weight(context.bodyweightKg, context)}.`);
  }
  if (context.goalWeightKg !== null) {
    lines.push(`Goal weight: ${weight(context.goalWeightKg, context)}.`);
  }

  if (context.trendDirection !== null) {
    const rate =
      context.trendDirection !== 'flat' && context.ratePerWeekKg !== null
        ? `, about ${weight(Math.abs(context.ratePerWeekKg), context)} a week`
        : '';
    lines.push(`Weight is ${TREND_LABELS[context.trendDirection]}${rate}.`);
  }

  if (context.sessionsThisWeek !== null) {
    lines.push(
      context.sessionsThisWeek === 1
        ? 'They have trained once so far this week.'
        : `They have trained ${context.sessionsThisWeek} times so far this week.`,
    );
  }
  if (context.streakWeeks !== null && context.streakWeeks > 0) {
    lines.push(
      context.streakWeeks === 1
        ? 'They are one week into a training streak.'
        : `They have kept a training streak going for ${context.streakWeeks} weeks.`,
    );
  }
  if (context.trainedToday === true) {
    lines.push('They have already trained today.');
  } else if (context.daysSinceLastSession !== null) {
    lines.push(
      context.daysSinceLastSession === 0
        ? 'Their last session was earlier today.'
        : context.daysSinceLastSession === 1
          ? 'Their last session was yesterday.'
          : `Their last session was ${context.daysSinceLastSession} days ago.`,
    );
  }
  if (context.weekVolumeKg !== null && context.weekVolumeKg > 0) {
    const total = Math.round(displayWeight(context.weekVolumeKg, context.unitPref));
    lines.push(`Total weight lifted this week: ${total} ${unitLabel(context.unitPref)}.`);
  }
  if (context.personalBestsLast30Days !== null && context.personalBestsLast30Days > 0) {
    lines.push(
      context.personalBestsLast30Days === 1
        ? 'They set one personal best in the last month.'
        : `They set ${context.personalBestsLast30Days} personal bests in the last month.`,
    );
  }

  return lines;
}

/** The whole user turn, built here from validated values. Never client prose. */
function userTurn(kind: AiTipKind, context: AiTipContext, variety: number): string {
  const facts = factLines(context);
  const parts = [
    facts.length > 0
      ? `What I know about this member:\n${facts.join('\n')}`
      : 'I know very little about this member yet.',
    ASKS[kind],
  ];
  if (variety > 0) {
    parts.push(
      `They have asked for another note (ask number ${variety}). Take a different angle from the obvious one and do not repeat an earlier idea.`,
    );
  }
  return parts.join('\n\n');
}

function tipResponse(text: string | null, status: AiTipStatus) {
  return json({ text, status }, 200);
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const perMinute = rateLimit({
    route: 'ai/tip',
    limit: PER_MINUTE_LIMIT,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (perMinute) return perMinute;

  const parsed = aiTipRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { kind, context, variety } = parsed.data;

  // Safety first, and before the daily quota: this answer costs nothing and a
  // member who trips it should not lose their budget over it.
  const safety = checkAiTipGoalSafety(context);
  if (!safety.ok && safety.message !== null) return tipResponse(safety.message, 'safety');

  // Honest about our own setup: no key is an operator problem, not an outage.
  if (!isGroqConfigured()) return tipResponse(null, 'not_configured');

  // The daily budget only counts calls that actually reach the model.
  const perDay = rateLimit({
    route: 'ai/tip/day',
    limit: PER_DAY_LIMIT,
    windowMs: DAY_MS,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (perDay) return perDay;

  const raw = await groqComplete(
    [
      { role: 'system', content: SYSTEM_PROMPTS[kind] },
      { role: 'user', content: userTurn(kind, context, variety) },
    ],
    { temperature: 0.8, maxTokens: MAX_OUTPUT_TOKENS, timeoutMs: MODEL_TIMEOUT_MS },
  );

  const text = sanitizeAiTipText(raw);
  return tipResponse(text, text === null ? 'unavailable' : 'ok');
}
