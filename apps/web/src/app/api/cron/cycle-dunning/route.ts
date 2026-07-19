import { cronEnabled, cronGuard, runCycleDunning } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → cycle-dunning scan (Pack B / WP-2). Guarded by CRON_SECRET
 * (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Idempotent via
 * per-cycle-per-day dedupe keys. Driven by `/api/cron/tick`; Pro may schedule
 * directly.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runCycleDunning();
  return json({ ok: true, ...result }, 200);
}
