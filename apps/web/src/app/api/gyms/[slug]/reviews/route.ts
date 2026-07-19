import { accounts, gymReviews } from '@gym/db';
import { isValidStars, maskPii, starsSchema } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { publishedGymBySlug } from '../../_lib';

export const runtime = 'nodejs';

/**
 * Genuine member gym reviews (Pack C / M — fixes B17's "no write path").
 *
 *  - GET  → the gym's VISIBLE reviews, newest first, paginated. Public — a
 *           review is content the author chose to publish, same posture as a
 *           product review anywhere else. Hidden (moderated-off) rows never
 *           appear here regardless of caller.
 *  - POST → the caller's OWN review for this gym. One per (gym, account) —
 *           `unique(gymId,accountId)` — so a second submission EDITS the
 *           first (upsert) rather than adding a duplicate; editing always
 *           resets `status` to 'visible' (an admin who previously hid a
 *           review gets a fresh look at the edited text, never a permanently
 *           re-silenced row). `note` is `maskPii`'d before storage — contact
 *           details never reach a public review.
 *
 * Unlike meal ratings there is no "delivered order" ownership signal for a
 * gym visit, so this does not gate on prior purchase — the moderation queue
 * (admin/gyms/reports) is the abuse backstop, not a purchase gate.
 */

const postSchema = z.object({
  stars: starsSchema,
  note: z.string().trim().max(500).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** First name + last-initial only — never the member's full legal/display
 * name on a page anyone can load signed out (privacy-conscious default for
 * the first member-authored public content this app has shipped). */
function publicAuthorName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return 'Member';
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (!first) return 'Member';
  if (parts.length === 1) return first;
  const lastInitial = parts[parts.length - 1]?.charAt(0).toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = rateLimit({ route: 'gyms.reviews.list', limit: 60, windowMs: 60_000, ip: clientIp(req) });
  if (limited) return limited;

  const { slug } = await params;
  const gym = await publishedGymBySlug(slug);
  if (!gym) return json({ error: 'not_found' }, 404);

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { limit, offset } = parsed.data;

  const rows = await getDb()
    .select({
      id: gymReviews.id,
      stars: gymReviews.stars,
      note: gymReviews.note,
      createdAt: gymReviews.createdAt,
      displayName: accounts.displayName,
    })
    .from(gymReviews)
    .innerJoin(accounts, eq(accounts.id, gymReviews.accountId))
    .where(and(eq(gymReviews.gymId, gym.id), eq(gymReviews.status, 'visible')))
    .orderBy(desc(gymReviews.createdAt))
    .limit(limit)
    .offset(offset);

  const reviews = rows.map((r) => ({
    id: r.id,
    stars: r.stars,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    authorName: publicAuthorName(r.displayName),
  }));

  return json({ reviews, limit, offset }, 200);
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'gyms.reviews.write',
    limit: 10,
    windowMs: 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { slug } = await params;
  const gym = await publishedGymBySlug(slug);
  if (!gym) return json({ error: 'not_found' }, 404);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const stars = parsed.data.stars;
  if (!isValidStars(stars)) return json({ error: 'invalid' }, 400);
  const note = maskPii(parsed.data.note ?? '');

  const db = getDb();
  const [review] = await db
    .insert(gymReviews)
    .values({ gymId: gym.id, accountId: user.id, stars, note, status: 'visible' })
    .onConflictDoUpdate({
      target: [gymReviews.gymId, gymReviews.accountId],
      set: { stars, note, status: 'visible' },
    })
    .returning({ id: gymReviews.id, stars: gymReviews.stars, note: gymReviews.note, createdAt: gymReviews.createdAt });

  return json({ review: { ...review, createdAt: review.createdAt.toISOString() } }, 201);
}
