import { buddyActivity, buddyLinks } from '@gym/db';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  linkId: z.string().min(1),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const links = await db
    .select({
      id: buddyLinks.id,
      requesterId: buddyLinks.requesterId,
      addresseeId: buddyLinks.addresseeId,
      status: buddyLinks.status,
    })
    .from(buddyLinks)
    .where(eq(buddyLinks.id, parsed.data.linkId))
    .limit(1);

  const link = links[0];
  if (!link) return json({ error: 'not_found' }, 404);
  if (link.requesterId !== me.id && link.addresseeId !== me.id) {
    return json({ error: 'forbidden' }, 403);
  }
  if (link.status !== 'accepted') return json({ error: 'invalid' }, 400);

  const buddyId = link.requesterId === me.id ? link.addresseeId : link.requesterId;

  // One nudge per buddy per UTC day.
  const now = new Date();
  const utcDayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const nudgedToday = await db
    .select({ id: buddyActivity.id })
    .from(buddyActivity)
    .where(
      and(
        eq(buddyActivity.accountId, me.id),
        eq(buddyActivity.type, 'nudge'),
        eq(buddyActivity.targetId, buddyId),
        gte(buddyActivity.createdAt, utcDayStart),
      ),
    )
    .limit(1);
  if (nudgedToday.length > 0) return json({ error: 'nudge_limit' }, 429);

  await db.insert(buddyActivity).values({
    accountId: me.id,
    type: 'nudge',
    targetId: buddyId,
    payload: {},
  });

  return json({ ok: true }, 201);
}
