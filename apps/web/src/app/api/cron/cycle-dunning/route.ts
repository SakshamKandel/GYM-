import { cronEnabled, cronGuard, runCycleDunning } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One scan is up to 500 rows of awaited dispatches, which does not fit in the
// seconds a serverless function gets by default — and a run killed part way
// through leaves notifications stamped as attempted that were never actually
// pushed (see the note on /api/cron/tick). Vercel clamps this to the plan's max.
export const maxDuration = 300;

/**
 * Vercel Cron → cycle-dunning scan (Pack B / WP-2). Guarded by CRON_SECRET
 * (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Idempotent via
 * per-cycle-per-day dedupe keys. Driven by `/api/cron/tick`; Pro may schedule
 * directly.
 *
 * Nothing in this repo calls this route, and that is deliberate: it is the
 * alternative entry point for a per-scan schedule, and for re-running just this
 * scan by hand without firing the rest.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runCycleDunning();
  return json({ ok: true, ...result }, 200);
}
