import { cronEnabled, cronGuard, runDay2Reengage } from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron → day-2 re-engagement scan (Pack B / WP-2). Guarded by
 * CRON_SECRET (fail-closed) and gated by NOTIFICATIONS_CRON_ENABLED. Fires at
 * most once per account (constant dedupe scope). Driven by `/api/cron/tick`;
 * Pro may schedule directly.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);
  const result = await runDay2Reengage();
  return json({ ok: true, ...result }, 200);
}
