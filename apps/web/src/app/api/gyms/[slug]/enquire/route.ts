import { maskPii } from '@gym/shared';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { publishedGymBySlug } from '../../_lib';

export const runtime = 'nodejs';

/**
 * "Enquire about membership" lead capture (Pack M — fixes B15's structural
 * dead-end after Call/Directions/Website). Mirrors the coach-request pattern
 * (member-initiated, PII-masked, staff-notified) with ONE deliberate
 * difference: gyms have no dedicated leads table in this wave (schema.ts is
 * WP-1-owned single-file-shared; the plan's WP-1 spec shipped `gym_reviews` /
 * `gym_favorites` / `gym_reports` but no `gym_enquiries`). So the durable
 * record of an enquiry IS the staff notification's own inbox row (WP-2's
 * `notifications` table, written before the push is even attempted) rather
 * than a second bespoke table — staff see it in their notification center
 * (WP-14) and can reply through the account's existing support channel.
 *
 * Member-only (so staff can follow up with a real account) and rate-limited
 * per-account across ALL gyms (not just this one) to blunt spam fan-out.
 */

const postSchema = z.object({
  message: z.string().trim().max(500).optional(),
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

  void notify(
    'gym_enquiry_staff',
    { role: 'staff', permission: 'gyms.manage' },
    {
      title: `Membership enquiry: ${gym.name}`,
      body: message ? `Member note: ${message}` : 'A member wants info about joining.',
      // `id` is the SLUG, not the row id — the mobile deep-link route is
      // /gyms/[slug], so this is directly routable with no extra lookup.
      data: { type: 'gym', id: slug },
    },
  );

  return json({ ok: true }, 200);
}
