import { gymEnquiries, gyms } from '@gym/db';
import { maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { publishedGymBySlug } from '../../_lib';

export const runtime = 'nodejs';

/**
 * "Enquire about membership" lead capture (Pack M — fixes B15's structural
 * dead-end after Call/Directions/Website). Mirrors the coach-request pattern
 * (member-initiated, PII-masked, staff-notified).
 *
 * The enquiry is persisted to `gym_enquiries` FIRST, then the staff
 * notification fires. Earlier waves had no leads table and leaned on the
 * notification's own inbox row as the record — which meant a member told "the
 * team will reach out" had nothing durable behind that promise once the
 * notification was read or a push failed, and no admin surface ever listed
 * them. The insert is awaited and its failure is fatal to the request (the
 * member sees the error and can retry) — a notification is a nudge, the row is
 * the lead. Staff work the queue at /admin/gyms/reports → Enquiries.
 *
 * Member-only (so staff can follow up with a real account) and rate-limited
 * per-account across ALL gyms (not just this one) to blunt spam fan-out.
 */

const postSchema = z.object({
  message: z.string().trim().max(500).optional(),
  // Optional: which pass option prompted the enquiry (day pass, monthly, …).
  // Validated against the gym's own pass_options below, never trusted raw.
  passId: z.string().trim().max(64).optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'gyms.enquire',
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const { slug } = await params;
  const gym = await publishedGymBySlug(slug);
  if (!gym) return json({ error: 'not_found' }, 404);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const message = maskPii(parsed.data.message ?? '');

  const db = getDb();

  // A pass id is a sub-object key inside the gym's `pass_options` jsonb, so it
  // can't be enforced by a foreign key — resolve it here instead. An id that
  // doesn't belong to THIS gym is dropped rather than 400'd: the enquiry is
  // still a real lead, and failing the whole request over a stale cached pass
  // list would lose it. Only queried when the client actually sent one.
  const requestedPassId = parsed.data.passId;
  let passId: string | null = null;
  if (requestedPassId) {
    const [row] = await db
      .select({ passOptions: gyms.passOptions })
      .from(gyms)
      .where(eq(gyms.id, gym.id))
      .limit(1);
    const match = row?.passOptions.find((p) => p.id === requestedPassId);
    passId = match ? match.id : null;
  }

  await db.insert(gymEnquiries).values({
    gymId: gym.id,
    accountId: user.id,
    passId,
    message,
    status: 'open',
  });

  after(() =>
    notify(
      'gym_enquiry_staff',
      { role: 'staff', permission: 'gyms.manage' },
      {
        title: `Membership enquiry: ${gym.name}`,
        body: message ? `Member note: ${message}` : 'A member wants info about joining.',
        // `id` is the SLUG, not the row id — the mobile deep-link route is
        // /gyms/[slug], so this is directly routable with no extra lookup.
        data: { type: 'gym', id: slug },
      },
    ),
  );

  return json({ ok: true }, 200);
}
