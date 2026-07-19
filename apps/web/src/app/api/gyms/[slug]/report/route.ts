import { gymReports } from '@gym/db';
import { maskPii } from '@gym/shared';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { publishedGymBySlug } from '../../_lib';

export const runtime = 'nodejs';

/**
 * Report-incorrect-info (Pack M — fixes B15's dead-end: there was no way to
 * flag a stale listing). Member-only so the report is attributable and
 * rate-limitable. Writes a `gym_reports` row (the admin moderation queue at
 * `/admin/gyms/reports` — plan §5 WP-11) AND pushes staff holding
 * `gyms.manage` via `notify('gym_report_staff', …)` so a report is never
 * purely a silent database row.
 *
 * `field` mirrors the exact enum on `gym_reports.field` in schema.ts — kept
 * as a local literal tuple (not a shared export) because
 * packages/shared/src/logic/gyms.ts is WP-1-owned and this route doesn't need
 * a NEW shared constant, just the existing enum's values restated for zod.
 */

const REPORT_FIELDS = ['hours', 'phone', 'address', 'location', 'closed', 'other'] as const;

const postSchema = z.object({
  field: z.enum(REPORT_FIELDS),
  note: z.string().trim().max(500).optional(),
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
    route: 'gyms.report',
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
  const { field } = parsed.data;
  const note = maskPii(parsed.data.note ?? '');

  const [report] = await getDb()
    .insert(gymReports)
    .values({ gymId: gym.id, accountId: user.id, field, note, status: 'open' })
    .returning({ id: gymReports.id });

  // Fire-and-forget (§7.1 contract) — never blocks the member's confirmation.
  void notify(
    'gym_report_staff',
    { role: 'staff', permission: 'gyms.manage' },
    {
      title: 'Gym listing reported',
      body: `${gym.name}: ${field}${note ? ` — Member note: ${note}` : ''}`,
      // `id` is the SLUG, not the row id — the mobile deep-link route is
      // /gyms/[slug], so this is directly routable with no extra lookup.
      data: { type: 'gym', id: slug },
    },
  );

  return json({ report }, 201);
}
