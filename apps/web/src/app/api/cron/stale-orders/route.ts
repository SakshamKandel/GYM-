import { cronEnabled, cronGuard, runStaleOrders } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → stale-orders sweep. Cancels orders a restaurant never confirmed
 * in time and escalates the ones a human still has to chase. Guarded by
 * CRON_SECRET (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Idempotent:
 * the cancel is a status compare-and-set and both nudges carry per-order dedupe
 * keys, so a re-run or a double-fire changes nothing.
 *
 * Nothing in this repo calls this route. It exists as an alternative entry
 * point, like its sibling scans: `/api/cron/tick` (the one schedule in the
 * repo-root vercel.json) runs this sweep on every tick, and this endpoint lets
 * a Pro-plan schedule drive it on its own cadence, or an operator re-run just
 * this sweep without firing everything else.
 *
 * Cadence matters more here than for the notice-only scans: an order is only
 * freed on the next run after its grace window passes, so on the daily tick a
 * member can wait until the following morning to hear that a dinner order was
 * cancelled. An hourly schedule against this endpoint closes that gap.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runStaleOrders();
  return json({ ok: true, ...result }, 200);
}
