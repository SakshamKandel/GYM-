import { z } from 'zod';
import type { BadgeProgressStats } from '@gym/shared';

/**
 * Badges API client — GET /api/gamification/badges. Same philosophy as
 * lib/api/gamification.ts: zod at the boundary, typed error codes, network
 * failures never block the UI (the badges screen falls back to "all locked"
 * plus a local cache — see features/gamification/store.ts).
 */

import { BASE_URL } from './client';
import { GamificationApiError, toGamificationError } from './gamification';

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

async function get(path: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
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

const badgeStatusSchema = z.enum(['logged', 'verified']);

const awardedBadgeSchema = z.object({
  badgeId: z.string(),
  status: badgeStatusSchema,
  earnedAt: z.string(),
  verifiedAt: z.string().nullable(),
});

export type AwardedBadge = z.infer<typeof awardedBadgeSchema>;

// The caller's OWN badge-progress stats (feeds the pure badgeProgress()
// evaluator for locked-badge progress bars). Shape mirrors @gym/shared's
// BadgeProgressStats; .catch(null) keeps older servers (no stats field)
// rendering the grid fine, just without progress bars.
const badgeStatsSchema: z.ZodType<BadgeProgressStats, z.ZodTypeDef, unknown> = z.object({
  bestE1RmByLift: z
    .object({
      bench: z.number().optional(),
      squat: z.number().optional(),
      deadlift: z.number().optional(),
      ohp: z.number().optional(),
    })
    .catch({}),
  lifetimeSessionDays: z.number(),
  lifetimeTonnageKg: z.number(),
  prCount: z.number(),
  streakWeeksBest: z.number(),
  checkInCount: z.number(),
  hasBuddy: z.boolean(),
});

const badgesResultSchema = z.object({
  badges: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): AwardedBadge[] => {
      const parsed = awardedBadgeSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  // challengeTitles is additive metadata for challenge:<id> extras — the
  // badges screen only needs a display name fallback, so keep this loose.
  challengeTitles: z.record(z.string()).catch({}),
  stats: badgeStatsSchema.nullable().catch(null),
});

export interface BadgesResult {
  badges: AwardedBadge[];
  challengeTitles: Record<string, string>;
  /** Null on old servers — the UI simply omits progress bars. */
  stats: BadgeProgressStats | null;
}

/**
 * GET /api/gamification/badges — the caller's own awarded badges (catalog
 * itself lives client-side in @gym/shared's BADGE_CATALOG).
 */
export async function getAwardedBadges(token: string): Promise<BadgesResult> {
  const data = await get('/api/gamification/badges', token);
  const parsed = badgesResultSchema.safeParse(data);
  if (!parsed.success) throw new GamificationApiError('network', 'Unexpected server response');
  return parsed.data;
}

export { toGamificationError };
