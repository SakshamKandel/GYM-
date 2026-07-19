import {
  type CronResult,
  cronEnabled,
  cronGuard,
  ktmHour,
  runCycleDunning,
  runDay2Reengage,
  runRenewalNudge,
  runRetryUnsent,
  runTrialExpiry,
} from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The KTM hour the once-daily scans fire on an hourly tick. */
const DAILY_HOUR = 6;

/**
 * Consolidated cron dispatcher — the mechanism registered in the repo-root
 * vercel.json. ONE Vercel Cron entry drives the whole async class, so it runs on
 * the Hobby plan (capped at 2 daily crons) as well as Pro. It "fans out by
 * wall-clock": retry-unsent runs EVERY tick (drains stragglers fast); the
 * once-daily scans run only when the KTM hour matches DAILY_HOUR. Every scan is
 * dedupe-guarded, so even a double-fire within the daily hour never
 * double-notifies.
 *
 * Schedule: hourly (`0 * * * *`) on Pro. On Hobby (daily granularity only) set it
 * to `0 6 * * *`; retry-unsent then runs once/day — stragglers drain within a day
 * while the durable inbox row holds the message in the meantime.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);

  const now = new Date();
  const ran: Record<string, CronResult> = {};

  // Every tick: reconcile the durable outbox.
  ran.retryUnsent = await runRetryUnsent(now);

  // Once per day, on the wall-clock hour, run the window scans.
  const daily = ktmHour(now) === DAILY_HOUR;
  if (daily) {
    ran.trialExpiry = await runTrialExpiry(now);
    ran.renewalNudge = await runRenewalNudge(now);
    ran.cycleDunning = await runCycleDunning(now);
    ran.day2Reengage = await runDay2Reengage(now);
  }

  return json({ ok: true, daily, ran }, 200);
}
