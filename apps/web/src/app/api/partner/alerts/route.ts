import { mealPartners } from '@gym/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePartner } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { loadPartnerAlerts } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * The partner portal's live watch (GET only).
 *
 * A restaurant is web-only: it has no phone in the kitchen signed into the app,
 * so the "new order" push written when a member checks out has no device to
 * land on. Without something watching the browser tab, an order placed while
 * nobody is staring at the board is simply missed. This route is that watch —
 * the portal polls it from EVERY page and rings in the open tab.
 *
 * `since` is the caller's cursor (an ISO instant it got from a previous poll).
 * Omit it and nothing is reported as new: a browser opening the portal for the
 * first time establishes its cursor instead of alarming the kitchen about
 * orders it has been working all morning.
 *
 * Scoped by `requirePartner`, which resolves the caller's OWN partnerId from
 * the session — never a parameter — so this can only ever describe one
 * restaurant's own queue.
 */

const querySchema = z.object({
  /** ISO instant from a previous poll's `serverTime`. Absent = first poll. */
  since: z.string().datetime().optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const guard = await requirePartner(req);
  if (guard instanceof Response) return guard;
  const { partnerId, principal } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ since: url.searchParams.get('since') ?? undefined });
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const since = parsed.data.since ? new Date(parsed.data.since) : null;
  if (since && Number.isNaN(since.getTime())) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const [row] = await db
    .select({ currency: mealPartners.currency })
    .from(mealPartners)
    .where(eq(mealPartners.id, partnerId))
    .limit(1);

  const alerts = await loadPartnerAlerts(
    db,
    partnerId,
    principal.id,
    row?.currency ?? 'NPR',
    since,
  );
  return json(alerts, 200);
}
