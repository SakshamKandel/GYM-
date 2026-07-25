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
 * Ask for the longest run this platform will give us. Six scans of up to 500
 * rows each, every one of them a sequence of awaited network calls, does not fit
 * in the few seconds a serverless function gets by default. Vercel clamps this
 * request down to whatever the plan actually allows (the same thing
 * /api/admin/broadcast does), which is exactly why the budget below is sized
 * against the SMALLEST ceiling rather than this number.
 */
export const maxDuration = 300;

/**
 * Stop starting new scans once this much of the invocation is gone.
 *
 * This is the "cannot silently eat a notification" guard. Every notification
 * this tick sends is stamped as attempted BEFORE it is dispatched (see the long
 * note in lib/notify.ts — it is the right trade, because the alternative is
 * re-delivering pushes people already got). The cost of that trade is that a
 * process killed mid-dispatch leaves rows stamped that were never actually
 * pushed, and nothing retries them: the member still sees the message in their
 * notification list, but the push never arrives. A tick that is killed by the
 * platform is therefore not free, so this tick makes sure it finishes on its own
 * terms instead.
 *
 * 30 seconds is deliberately far below the smallest ceiling a plan grants (60
 * seconds), leaving at least that much headroom for whichever scan is already
 * running when the budget runs out. Scans that do not get to start are simply
 * left for the next tick: every one of them is bounded, forward-progressing and
 * idempotent, so nothing is lost by running it later.
 */
const SCAN_BUDGET_MS = 30_000;

/**
 * Run order. retry-unsent stays first for two reasons: it is the cheapest, and
 * it is the scan with the most to lose from being cut short, so it gets the
 * whole budget ahead of it.
 */
const SCANS: readonly { name: string; run: (now: Date) => Promise<CronResult> }[] = [
  { name: 'retryUnsent', run: runRetryUnsent },
  { name: 'trialExpiry', run: runTrialExpiry },
  { name: 'renewalNudge', run: runRenewalNudge },
  { name: 'cycleDunning', run: runCycleDunning },
  { name: 'day2Reengage', run: runDay2Reengage },
  // Fulfilment sweep: cancels orders no restaurant confirmed in time and
  // escalates the ones that still need a human. Same conventions as the scans
  // above — bounded, forward-progressing, and idempotent (the cancel is a
  // status compare-and-set, the nudges carry per-order dedupe keys), so it is
  // safe on every tick and safe to run twice.
  { name: 'staleOrders', run: runStaleOrders },
];

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
 * The only thing a tick will not do is start a scan it has no time left to
 * finish (see SCAN_BUDGET_MS). Anything skipped comes back on the next tick and
 * is named in the `deferred` list of the response, so a tick that is chronically
 * out of time shows up in the logs instead of quietly dropping pushes.
 *
 * Schedule: any cadence works — hourly (`0 * * * *`) on Pro drains outbox
 * stragglers faster; daily (the current `0 3 * * *`, Hobby's limit) still runs
 * every scan exactly once a day.
 */
export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  if (!cronEnabled()) return json({ skipped: 'disabled' }, 200);

  const startedAt = Date.now();
  const now = new Date();
  const ran: Record<string, CronResult> = {};
  const deferred: string[] = [];

  for (const scan of SCANS) {
    if (Date.now() - startedAt >= SCAN_BUDGET_MS) {
      deferred.push(scan.name);
      continue;
    }
    ran[scan.name] = await scan.run(now);
  }

  if (deferred.length > 0) {
    console.warn(
      `[cron:tick] out of time after ${Date.now() - startedAt}ms; deferred to the next tick: ${deferred.join(', ')}`,
    );
  }

  // `daily` stays in the payload (existing callers/log greps read it) and is now
  // always true: the window scans run on every tick. `deferred` is additive —
  // empty on a healthy tick.
  return json({ ok: true, daily: true, ran, deferred }, 200);
}
