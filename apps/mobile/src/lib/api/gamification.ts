import { z } from 'zod';

/**
 * Gamification API client — GET/PATCH the member's XP/rank/streak/shield
 * snapshot and the caller's own flagged-workout list. Same philosophy as
 * `client.ts`: zod at the boundary, typed error codes, network failures never
 * block the UI (screens keep local-computed data and merge server data in
 * when it arrives).
 */

import { BASE_URL } from './client';

const REQUEST_TIMEOUT_MS = 10_000;

export type GamificationErrorCode = 'unauthorized' | 'invalid' | 'network';

export class GamificationApiError extends Error {
  readonly code: GamificationErrorCode;

  constructor(code: GamificationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GamificationApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to GamificationApiError (anything else = network). */
export function toGamificationError(err: unknown): GamificationApiError {
  return err instanceof GamificationApiError ? err : new GamificationApiError('network');
}

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
  method: 'GET' | 'PATCH';
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

  let code: GamificationErrorCode = res.status === 401 ? 'unauthorized' : 'network';
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

// ── Schemas (mirrors GamificationResult in apps/web/src/lib/gamification.ts) ──

const rankSchema = z.enum(['bronze', 'silver', 'gold', 'elite']);
export type GamificationRank = z.infer<typeof rankSchema>;

const gamificationProfileSchema = z.object({
  xpTotal: z.number(),
  level: z.number(),
  xpIntoLevel: z.number(),
  xpForNextLevel: z.number(),
  rank: rankSchema,
  weeklyTargetDays: z.number(),
});

const gamificationStreakSchema = z.object({
  weeks: z.number(),
  bestWeeks: z.number(),
  thisWeekDays: z.number(),
  weekStart: z.string(),
  shieldedWeekStarts: z.array(z.string()),
});

const gamificationShieldsSchema = z.object({
  quota: z.number(),
  usedThisMonth: z.number(),
  remaining: z.number(),
});

const gamificationBadgesSummarySchema = z.object({
  earned: z.number(),
  total: z.number(),
});

const gamificationSnapshotSchema = z.object({
  profile: gamificationProfileSchema,
  streak: gamificationStreakSchema,
  shields: gamificationShieldsSchema,
  badges: gamificationBadgesSummarySchema,
});

export type GamificationSnapshot = z.infer<typeof gamificationSnapshotSchema>;

const patchResultSchema = z.object({ ok: z.literal(true), weeklyTargetDays: z.number() });

/**
 * GET /api/gamification — full profile/streak/shields/badges snapshot. This
 * also runs the award engine server-side (idempotent), so it's safe to call
 * on every home/settings focus.
 */
export async function getGamificationSnapshot(token: string): Promise<GamificationSnapshot> {
  const data = await request({ method: 'GET', path: '/api/gamification', token });
  return parseAs(gamificationSnapshotSchema, data);
}

/** PATCH /api/gamification { weeklyTargetDays: 2..7 } — updates the server-side target. */
export async function patchWeeklyTarget(token: string, weeklyTargetDays: number): Promise<number> {
  const data = await request({
    method: 'PATCH',
    path: '/api/gamification',
    token,
    body: { weeklyTargetDays },
  });
  return parseAs(patchResultSchema, data).weeklyTargetDays;
}

const flagSchema = z.object({
  workoutId: z.string(),
  date: z.string(),
  name: z.string(),
  reason: z.string().nullable(),
});

export type GamificationFlag = z.infer<typeof flagSchema>;

const flagsResultSchema = z.object({
  flags: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): GamificationFlag[] => {
      const parsed = flagSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/gamification/flags — the caller's own unranked workouts, newest first (limit 20). */
export async function getGamificationFlags(token: string): Promise<GamificationFlag[]> {
  const data = await request({ method: 'GET', path: '/api/gamification/flags', token });
  return parseAs(flagsResultSchema, data).flags;
}

/**
 * GET /api/gamification/flags?workoutId=<id> — that single workout's flag
 * status, regardless of how far back it is. Use this for a per-workout
 * detail check instead of `getGamificationFlags` + `.some()` — the list
 * endpoint truncates to the 20 newest flags, so an older flagged workout
 * would otherwise show no notice at all.
 */
export async function getGamificationFlagForWorkout(
  token: string,
  workoutId: string,
): Promise<GamificationFlag | null> {
  const data = await request({
    method: 'GET',
    path: `/api/gamification/flags?workoutId=${encodeURIComponent(workoutId)}`,
    token,
  });
  const flags = parseAs(flagsResultSchema, data).flags;
  return flags[0] ?? null;
}
