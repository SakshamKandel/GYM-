import {
  type CronResult,
  cronEnabled,
  cronGuard,
  runCycleDunning,
  runDay2Reengage,
  runRenewalNudge,
  runRetryUnsent,
  runStaleOrders,
  runTrialExpiry,
} from '@/lib/cron';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Consolidated cron dispatcher — the mechanism registered in the repo-root
 * vercel.json. ONE Vercel Cron entry drives the whole async class, so it runs on
 * the Hobby plan (capped at daily granularity) as well as Pro.
 *
 * EVERY scan runs on EVERY tick. There is deliberately NO wall-clock gate.
 * A previous version only ran the four window scans when the KTM hour equalled
 * a hard-coded 6, while the deployed schedule fires at 03:00 UTC (08:45 KTM) —
 * so trial-expiry, renewal-nudge, cycle-dunning and day2-reengage never ran at
 * all. Running them unconditionally is safe because each scan (see lib/cron.ts)
 * is BOUNDED (BATCH=500 per run), FORWARD-PROGRESSING (anti-joined against the
 * durable notifications outbox, so already-notified rows drop out) and
 * IDEMPOTENT (a `cronDedupeKey` + the `notifications_dedupe` partial unique make
 * a re-run or a provider double-fire a no-op). Extra ticks therefore cost a few
 * bounded index scans and never double-notify a member.
 *
 * Schedule: any cadence works — hourly (`0 * * * *`) on Pro drains outbox
 * stragglers faster; daily (the current `0 3 * * *`, Hobby's limit) still runs
 * every scan exactly once a day.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);

  const now = new Date();
  const ran: Record<string, CronResult> = {};

  // Reconcile the durable outbox first — cheapest, and it drains anything the
  // scans below wrote on the previous tick.
  ran.retryUnsent = await runRetryUnsent(now);

  ran.trialExpiry = await runTrialExpiry(now);
  ran.renewalNudge = await runRenewalNudge(now);
  ran.cycleDunning = await runCycleDunning(now);
  ran.day2Reengage = await runDay2Reengage(now);

  // Fulfilment sweep: cancels orders no restaurant confirmed in time and
  // escalates the ones that still need a human. Same conventions as the scans
  // above — bounded, forward-progressing, and idempotent (the cancel is a
  // status compare-and-set, the nudges carry per-order dedupe keys), so it is
  // safe on every tick and safe to run twice.
  ran.staleOrders = await runStaleOrders(now);

  // `daily` stays in the payload (existing callers/log greps read it) and is now
  // always true: the window scans run on every tick.
  return json({ ok: true, daily: true, ran }, 200);
}
