import { z } from 'zod';

/**
 * Social gamification API client — buddy leaderboard, buddy co-op quest, and
 * the caller's active coach challenge. Same philosophy as lib/api/badges.ts
 * and lib/api/gamification.ts: zod at the boundary, typed error codes,
 * network failures never block the UI (screens keep whatever they last
 * rendered and show a quiet stale/retry affordance, matching useBuddyData).
 *
 * Design law 5 (XP/rank personal-only): none of these schemas carry xp/level
 * fields — the server never sends them here, and these types don't leave
 * room for a future accidental leak either. Two narrow exceptions: `tier` is
 * membership identity (subscription plan), not gamification — it never
 * affects XP, rank, sort order, or leaderboard position (leaderboard sort
 * stays sessionDays-only), it's purely rendered as the metallic TierBadge.
 * And the public board carries the earned `rank` NAME only (bronze/silver/
 * gold/elite, no level number) — rendered as a ring-only RankEmblem, never
 * used for ordering.
 */

import { BASE_URL } from './client';
import { GamificationApiError, toGamificationError } from './gamification';

// Old servers may not send `tier` yet — .catch keeps this schema tolerant.
const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']).catch('starter');

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const errorBodySchema = z.object({ error: z.string() });

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

async function request(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new GamificationApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new GamificationApiError('network', 'Unexpected server response');
    }
  }

  let code: 'unauthorized' | 'invalid' | 'network' = res.status === 401 ? 'unauthorized' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success && parsed.data.error === 'invalid') code = 'invalid';
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new GamificationApiError(code);
}

function parseAs<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new GamificationApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Leaderboard ─────────────────────────────────────────────────

const leaderboardRowSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  sessionDays: z.number(),
  isMe: z.boolean(),
  tier: tierSchema,
});

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

const leaderboardResultSchema = z.object({
  month: z.string(),
  rows: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): LeaderboardRow[] => {
      const parsed = leaderboardRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export interface LeaderboardResult {
  month: string;
  rows: LeaderboardRow[];
}

/** GET /api/buddy/leaderboard — this month's session-day ranking (caller + accepted buddies). */
export async function getBuddyLeaderboard(token: string): Promise<LeaderboardResult> {
  const data = await request({ method: 'GET', path: '/api/buddy/leaderboard', token });
  return parseAs(leaderboardResultSchema, data);
}

// ── Co-op quest ─────────────────────────────────────────────────

const questPairSchema = z.object({
  buddyAccountId: z.string(),
  displayName: z.string(),
  mine: z.number(),
  theirs: z.number(),
  complete: z.boolean(),
});

export type QuestPair = z.infer<typeof questPairSchema>;

const questResultSchema = z.object({
  month: z.string(),
  target: z.number(),
  pairs: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): QuestPair[] => {
      const parsed = questPairSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export interface QuestResult {
  month: string;
  target: number;
  pairs: QuestPair[];
}

/** GET /api/buddy/quest — "both log N session-days this month" progress per buddy pair. */
export async function getBuddyQuest(token: string): Promise<QuestResult> {
  const data = await request({ method: 'GET', path: '/api/buddy/quest', token });
  return parseAs(questResultSchema, data);
}

// ── Coach challenge ─────────────────────────────────────────────

const challengeSchema = z.object({
  id: z.string(),
  title: z.string(),
  monthKey: z.string(),
  targetDays: z.number(),
  coachName: z.string(),
  joined: z.boolean(),
  myDays: z.number(),
  complete: z.boolean(),
});

export type Challenge = z.infer<typeof challengeSchema>;

const challengeResultSchema = z.object({
  challenge: challengeSchema.nullable().catch(null),
});

/** GET /api/challenges — the caller's active coach's challenge for the current month, or null. */
export async function getChallenge(token: string): Promise<Challenge | null> {
  const data = await request({ method: 'GET', path: '/api/challenges', token });
  return parseAs(challengeResultSchema, data).challenge;
}

export type ChallengeJoinErrorCode = 'unauthorized' | 'wrong_month' | 'forbidden' | 'not_found' | 'network';

/**
 * POST /api/challenges/{id}/join — opt into the coach's active monthly
 * challenge. Returns null on success, or a typed error code the caller maps
 * to a friendly line (mirrors the buddy client's toBuddyError pattern).
 *
 * The route's error body carries its own specific codes (wrong_month /
 * forbidden / not_found) that don't fit GamificationApiError's narrower
 * unauthorized|invalid|network set, so this reads the response directly
 * instead of going through the shared `request()` helper.
 */
export async function joinChallenge(token: string, challengeId: string): Promise<ChallengeJoinErrorCode | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/api/challenges/${challengeId}/join`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch {
    return 'network';
  }

  if (res.ok) return null;
  if (res.status === 401) return 'unauthorized';

  try {
    const body = await res.json();
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      if (parsed.data.error === 'wrong_month') return 'wrong_month';
      if (parsed.data.error === 'forbidden') return 'forbidden';
      if (parsed.data.error === 'not_found') return 'not_found';
    }
  } catch {
    // Body wasn't JSON — fall through to the generic network code.
  }
  return 'network';
}

// ── Public consistency leaderboard ──────────────────────────────

// Earned gamification rank NAME only (never a level number). Tolerant .catch
// for the same reason as tierSchema — an older server response never breaks
// the board, it just renders the base rank.
const rankSchema = z.enum(['bronze', 'silver', 'gold', 'elite']).catch('bronze');

export type PublicRank = z.infer<typeof rankSchema>;

// PRIVACY LAW: exactly these fields and nothing else — no workout details,
// no body data, no e1RM. `avatarUrl` is reserved (always null today); the
// client falls back to the letter avatar.
const publicRowSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable().catch(null),
  tier: tierSchema,
  rank: rankSchema,
  sessionDays: z.number(),
  position: z.number(),
  isMe: z.boolean(),
});

export type PublicLeaderboardRow = z.infer<typeof publicRowSchema>;

const publicMeSchema = z.object({
  /** Absolute competition rank — null when hidden or no sessions yet. */
  position: z.number().nullable().catch(null),
  sessionDays: z.number(),
  hidden: z.boolean(),
});

const publicLeaderboardResultSchema = z.object({
  month: z.string(),
  // Per-row flatMap tolerance (same as leaderboardResultSchema): one
  // malformed row never hides the whole board.
  rows: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): PublicLeaderboardRow[] => {
      const parsed = publicRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  me: publicMeSchema,
});

export interface PublicLeaderboardResult {
  month: string;
  rows: PublicLeaderboardRow[];
  me: z.infer<typeof publicMeSchema>;
}

/**
 * GET /api/leaderboard/public — top 50 accounts gym-wide by session-days this
 * calendar month (sort = sessionDays ONLY — never kg, XP, or tier), plus the
 * caller's own absolute position even when outside the top 50. Members hidden
 * via the opt-out flag never appear.
 */
export async function getPublicLeaderboard(token: string): Promise<PublicLeaderboardResult> {
  const data = await request({ method: 'GET', path: '/api/leaderboard/public', token });
  return parseAs(publicLeaderboardResultSchema, data);
}

const patchHiddenResultSchema = z.object({ hidden: z.boolean() });

/**
 * PATCH /api/leaderboard/public — set the caller's public-board opt-out flag
 * (`hidden: true` = never appears on the board). Returns the server's stored
 * value so callers can reconcile their local mirror.
 */
export async function setPublicBoardHidden(token: string, hidden: boolean): Promise<boolean> {
  const data = await request({
    method: 'PATCH',
    path: '/api/leaderboard/public',
    token,
    body: { hidden },
  });
  return parseAs(patchHiddenResultSchema, data).hidden;
}

export { toGamificationError };
