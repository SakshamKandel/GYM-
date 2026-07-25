import { cronEnabled, cronGuard, runRetryUnsent } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → retry-unsent reconcile (Pack B / E2 durable outbox). Re-dispatches
 * inbox rows whose push never landed (`sentAt IS NULL`) within the recent window,
 * so a crash between DB-commit and FCM-send never loses a notification. Guarded by
 * CRON_SECRET (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Wants a HIGH
 * frequency — the `/api/cron/tick` dispatcher runs it on EVERY tick.
 *
 * Nothing in this repo calls this route, and that is deliberate: it is the
 * alternative entry point for a schedule that can afford more than one cron
 * entry (this is the scan that most wants an hourly one), and for re-running
 * just this scan by hand without firing the rest.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runRetryUnsent();
  return json({ ok: true, ...result }, 200);
}
