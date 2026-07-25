import { cronEnabled, cronGuard, runRenewalNudge } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → renewal-nudge scan (Pack B / WP-2). Guarded by CRON_SECRET
 * (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Idempotent via
 * per-account dedupe keys. Driven by `/api/cron/tick`; Pro may schedule directly.
 *
 * Nothing in this repo calls this route, and that is deliberate: it is the
 * alternative entry point for a per-scan schedule, and for re-running just this
 * scan by hand without firing the rest.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runRenewalNudge();
  return json({ ok: true, ...result }, 200);
}
