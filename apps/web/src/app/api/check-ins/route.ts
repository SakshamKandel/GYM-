import { checkIns } from '@gym/db';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Weekly coach check-ins (member side).
 *
 *  - POST → insert one check-in, idempotent on BOTH the client UUID (pk) and
 *    the (account, date) unique index via ON CONFLICT DO NOTHING. A fresh
 *    insert returns 201; a replay (retry, or a second submit the same day)
 *    returns 200 with the EXISTING row so the client converges either way.
 *    accountId always comes from the bearer token.
 *  - GET ?limit=10 → newest first. The mobile store hydrates `lastCheckInAt`
 *    from this on sign-in, so due-state survives a reinstall.
 */

const postSchema = z.object({
  id: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bodyweightKg: z.number().min(0).max(1_000).nullish(),
  sleep: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  soreness: z.number().int().min(1).max(5),
  note: z.string().max(2_000).optional(),
  summary: z.object({
    sessions: z.number().int().min(0).max(100),
    volumeKg: z.number().min(0).max(10_000_000),
    prCount: z.number().int().min(0).max(1_000),
  }),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const body = parsed.data;

  const db = getDb();

  const inserted = await db
    .insert(checkIns)
    .values({
      id: body.id,
      accountId: user.id,
      date: body.date,
      bodyweightKg: body.bodyweightKg ?? null,
      sleep: body.sleep,
      energy: body.energy,
      soreness: body.soreness,
      note: body.note ?? '',
      summary: body.summary,
    })
    .onConflictDoNothing()
    .returning();

  const created = inserted[0];
  if (created) return json({ checkIn: created }, 201);

  // Conflict — either the same UUID replayed or a second check-in today.
  // Return the caller's existing row; a foreign UUID collision (someone
  // else's id) matches nothing here and is rejected.
  const existing = await db
    .select()
    .from(checkIns)
    .where(
      and(
        eq(checkIns.accountId, user.id),
        or(eq(checkIns.id, body.id), eq(checkIns.date, body.date)),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) return json({ error: 'conflict' }, 409);
  return json({ checkIn: row }, 200);
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const raw = Number(new URL(req.url).searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 10;

  const rows = await getDb()
    .select()
    .from(checkIns)
    .where(eq(checkIns.accountId, user.id))
    .orderBy(desc(checkIns.createdAt))
    .limit(limit);

  return json({ checkIns: rows }, 200);
}
