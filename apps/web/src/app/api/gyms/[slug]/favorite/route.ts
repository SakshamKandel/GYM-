import { gymFavorites } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { gymBySlugAnyStatus, publishedGymBySlug } from '../../_lib';

export const runtime = 'nodejs';

/**
 * Save / un-save a gym to the member's shortlist (Pack M). Member-only.
 *  - POST   → add (idempotent — a second POST on an already-favorited gym is
 *             a no-op via `onConflictDoNothing`, composite PK `(accountId,
 *             gymId)`).
 *  - DELETE → remove (idempotent — deleting a non-favorite is a no-op).
 * Both return the resulting `{favorited}` state so the client can render
 * from the response rather than assuming success.
 */

export function OPTIONS() {
  return preflight();
}

async function requireMember(req: Request): Promise<{ id: string } | Response> {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);
  return user;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await requireMember(req);
  if (user instanceof Response) return user;

  const limited = rateLimit({
    route: 'gyms.favorite',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { slug } = await params;
  const gym = await publishedGymBySlug(slug);
  if (!gym) return json({ error: 'not_found' }, 404);

  await getDb()
    .insert(gymFavorites)
    .values({ accountId: user.id, gymId: gym.id })
    .onConflictDoNothing({ target: [gymFavorites.accountId, gymFavorites.gymId] });

  return json({ favorited: true }, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await requireMember(req);
  if (user instanceof Response) return user;

  const limited = rateLimit({
    route: 'gyms.favorite',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { slug } = await params;
  const gym = await gymBySlugAnyStatus(slug);
  if (!gym) return json({ error: 'not_found' }, 404);

  await getDb()
    .delete(gymFavorites)
    .where(and(eq(gymFavorites.accountId, user.id), eq(gymFavorites.gymId, gym.id)));

  return json({ favorited: false }, 200);
}
