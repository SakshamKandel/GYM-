import { accounts, referrals } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authedUser } from '@/lib/buddy';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  inviteeEmail: z.string().email(),
});

export function OPTIONS() {
  return preflight();
}

/** GET — list this user's referrals and their status. */
export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const db = getDb();
  const rows = await db
    .select({
      id: referrals.id,
      inviteeEmail: referrals.inviteeEmail,
      status: referrals.status,
      createdAt: referrals.createdAt,
      rewardedAt: referrals.rewardedAt,
    })
    .from(referrals)
    .where(eq(referrals.referrerId, me.id))
    .orderBy(referrals.createdAt);

  return json({ referrals: rows }, 200);
}

/** POST — create a referral invite for a friend's email. */
export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const email = parsed.data.inviteeEmail.toLowerCase();
  const db = getDb();

  // Check if this referrer already invited this email (matches the
  // (referrerId, inviteeEmail) unique index).
  const existing = await db
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(eq(referrals.referrerId, me.id), eq(referrals.inviteeEmail, email)))
    .limit(1);

  if (existing.length > 0) return json({ error: 'already_linked' }, 409);

  // Check if the invitee already has an account — if so, mark as joined.
  const inviteeAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);

  const status = inviteeAccount[0] ? 'joined' : 'pending';

  await db.insert(referrals).values({
    referrerId: me.id,
    inviteeEmail: email,
    inviteeId: inviteeAccount[0]?.id ?? null,
    status,
  });

  return json({ ok: true, status }, 201);
}
