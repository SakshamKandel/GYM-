import { coachAssignments, coachReviews } from '@gym/db';
import { isValidStars, maskPii, starsSchema } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * A member's rating of their (current or former) coach (Pack C / L, WP-13
 * contract: "reads coach_reviews POST from WP-1 shape"). New endpoint file —
 * not under `api/coach/**` (WP-10's tree) or `api/coaches/[id]` (the public
 * profile route) — so no other package's file is touched.
 *
 *  - GET  → the caller's OWN review of this coach, or null.
 *  - POST → upsert (unique(coachId,memberId) — a second submission edits the
 *           first, mirroring the gym-reviews pattern). Authz: the caller
 *           must have (or have had) a coachAssignments row with this coach —
 *           you can only rate a coach who actually coached you, active or
 *           ended (an ended assignment is exactly the "rate on the way out"
 *           moment Pack L wants). `note` is `maskPii`'d before storage.
 */

const postSchema = z.object({
  stars: starsSchema,
  note: z.string().trim().max(500).optional(),
});

async function wasEverAssigned(coachId: string, memberId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.userId, memberId)))
    .limit(1);
  return rows.length > 0;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { id: coachId } = await params;

  const rows = await getDb()
    .select({
      stars: coachReviews.stars,
      note: coachReviews.note,
      createdAt: coachReviews.createdAt,
    })
    .from(coachReviews)
    .where(and(eq(coachReviews.coachId, coachId), eq(coachReviews.memberId, user.id)))
    .limit(1);

  const row = rows[0];
  return json(
    { review: row ? { ...row, createdAt: row.createdAt.toISOString() } : null },
    200,
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'coaches.review.write',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { id: coachId } = await params;

  if (!(await wasEverAssigned(coachId, user.id))) {
    return json({ error: 'not_found' }, 404);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const stars = parsed.data.stars;
  if (!isValidStars(stars)) return json({ error: 'invalid' }, 400);
  const note = maskPii(parsed.data.note ?? '');

  const db = getDb();
  const [review] = await db
    .insert(coachReviews)
    .values({ coachId, memberId: user.id, stars, note })
    .onConflictDoUpdate({
      target: [coachReviews.coachId, coachReviews.memberId],
      set: { stars, note },
    })
    .returning({ stars: coachReviews.stars, note: coachReviews.note, createdAt: coachReviews.createdAt });

  return json({ review: { ...review, createdAt: review.createdAt.toISOString() } }, 201);
}
