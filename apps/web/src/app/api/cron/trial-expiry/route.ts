import { cronEnabled, cronGuard, runTrialExpiry } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → trial-expiry scan (Pack B / WP-2). Guarded by CRON_SECRET
 * (fail-closed, §7.2-S4) and gated by NOTIFICATIONS_CRON_ENABLED (ships dark,
 * §9.1). Idempotent via per-account dedupe keys, so a double-fire is a no-op.
 * The `/api/cron/tick` dispatcher (repo-root vercel.json) drives this on any
 * plan; on Pro you may schedule this endpoint directly instead.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runTrialExpiry();
  return json({ ok: true, ...result }, 200);
}
