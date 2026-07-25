import { cronEnabled, cronGuard, runTrialExpiry } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One scan is up to 500 rows of awaited dispatches, which does not fit in the
// seconds a serverless function gets by default — and a run killed part way
// through leaves notifications stamped as attempted that were never actually
// pushed (see the note on /api/cron/tick). Vercel clamps this to the plan's max.
export const maxDuration = 300;

/**
 * Vercel Cron → trial-expiry scan (Pack B / WP-2). Guarded by CRON_SECRET
 * (fail-closed, §7.2-S4) and gated by NOTIFICATIONS_CRON_ENABLED (ships dark,
 * §9.1). Idempotent via per-account dedupe keys, so a double-fire is a no-op.
 * The `/api/cron/tick` dispatcher (repo-root vercel.json) drives this on any
 * plan; on Pro you may schedule this endpoint directly instead.
 *
 * Nothing in this repo calls this route, and that is deliberate: it is the
 * alternative entry point for a per-scan schedule, and for re-running just this
 * scan by hand without firing the rest.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runTrialExpiry();
  return json({ ok: true, ...result }, 200);
}
