import { auditLog, notifications, revenuecatEvents } from '@gym/db';
import {
  and,
  asc,
  count,
  desc,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Card,
  CardHeader,
  type Column,
  DataTable,
  PageHeader,
  StatTile,
} from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { relativeTime } from '../_overview/ui';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'System health' };
export const dynamic = 'force-dynamic';

/**
 * Admin — System health. READ-ONLY by design: it answers "is the machinery
 * behind the console still running?" and offers no buttons that change
 * anything, so an operator can open it during an incident without being able to
 * make the incident worse. Every repair still lives on the queue that owns it.
 *
 * It covers the three places work used to disappear silently:
 *
 *  1. The notification outbox. `notify()` writes the row first and flips
 *     `sent_at` once the push actually leaves; a row stuck with `sent_at` null
 *     is a message a member never received. Nothing surfaced that anywhere.
 *  2. Store (RevenueCat) webhook outcomes. A payment whose event never matched
 *     an account, or matched one but never applied a tier, is a member who paid
 *     and did not get their plan — previously invisible outside the database.
 *  3. Scheduled jobs. The daily tick drives every reminder; if it stops, the
 *     only symptom is silence.
 *
 * Gated on 'analytics.read' (super/main only, delegable via a per-account
 * override) — the same key as the other whole-platform readouts.
 */

/** A notification unsent for longer than this is worth an operator's attention. */
const STUCK_AFTER_MINUTES = 30;
/** Past this, the daily retry sweep has had at least one chance and still failed. */
const STUCK_AFTER_HOURS = 24;
/** How far back the scheduled-job evidence looks. Older than this reads as "not running". */
const JOB_LOOKBACK_DAYS = 30;
/** Row caps — this page must stay cheap enough to open during an incident. */
const RECENT_LIMIT = 8;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** ISO-8601 (UTC) rendering of a `max()`/`min()` timestamp — parseable everywhere. */
const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

interface StuckNotification {
  id: string;
  event: string;
  accountId: string;
  createdAt: Date;
}

interface WebhookProblem {
  eventId: string;
  type: string;
  /** Did the store event resolve to one of our accounts at all? */
  matched: boolean;
  /** Did the handler get as far as granting (or deliberately skipping) the plan? */
  tierApplied: boolean;
  receivedAt: Date;
}

interface OutboxHealth {
  waiting: number;
  waitingOverADay: number;
  oldestWaitingAt: Date | null;
  recent: StuckNotification[];
}

interface WebhookHealth {
  unmatched: number;
  neverApplied: number;
  recent: WebhookProblem[];
}

/**
 * One scheduled job, with both kinds of evidence we can honestly offer:
 * `lastRunAt` is an explicit audit record of the job running, `lastOutputAt` is
 * the last time it actually produced a message. A job that ran but had nothing
 * to do leaves only the first; a job nobody audits leaves only the second.
 */
interface JobHealth {
  key: string;
  label: string;
  what: string;
  lastRunAt: Date | null;
  lastOutputAt: Date | null;
}

/** Cron-driven notification events, in the order the daily tick runs them. */
const JOBS: readonly { key: string; event: string | null; label: string; what: string }[] = [
  {
    key: 'retry_unsent',
    event: null,
    label: 'Push retry sweep',
    what: 'Re-sends messages whose push did not go out the first time.',
  },
  {
    key: 'trial_expiry',
    event: 'trial_expiry',
    label: 'Plan-ended notices',
    what: 'Tells a member their paid plan has run out.',
  },
  {
    key: 'renewal_nudge',
    event: 'renewal_nudge',
    label: 'Renewal reminders',
    what: 'Warns a member a few days before their plan ends.',
  },
  {
    key: 'cycle_dunning',
    event: 'cycle_dunning',
    label: 'Meal payment reminders',
    what: 'Chases an unpaid week on a meal subscription.',
  },
  {
    key: 'day2_reengage',
    event: 'day2_reengage',
    label: 'Day-two welcome nudge',
    what: 'A single nudge to a member the day after they sign up.',
  },
];

/** 'cron.trial-expiry' / 'cron.trial_expiry' → 'trialexpiry', so either spelling matches. */
function normalizeJobKey(value: string): string {
  return value.replace(/^cron\./, '').replace(/[-_.]/g, '').toLowerCase();
}

/** Parses a `to_char(... ISO_UTC)` cell back into a Date. */
function parseIso(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "3h ago", or an em dash when there is nothing to report. */
function ago(date: Date | null): string {
  return date ? relativeTime(date) : '—';
}

/** Humanizes an event/action key ("renewal_nudge" → "Renewal nudge"). */
function humanize(key: string): string {
  const cleaned = key.replace(/[._-]/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Short, non-identifying handle for an id — enough to match against a log line. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

/** The durable notification outbox: what is still waiting to go out, and since when. */
async function loadOutbox(now: Date): Promise<OutboxHealth> {
  const db = getDb();
  const stuckCutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * MINUTE_MS);
  const dayCutoff = new Date(now.getTime() - STUCK_AFTER_HOURS * HOUR_MS);

  // All four reads hit the `notifications_unsent` partial index (sent_at IS NULL).
  const [waitingRows, waitingDayRows, oldestRows, recentRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(isNull(notifications.sentAt), lte(notifications.createdAt, stuckCutoff))),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(isNull(notifications.sentAt), lte(notifications.createdAt, dayCutoff))),
    db
      .select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(isNull(notifications.sentAt))
      .orderBy(asc(notifications.createdAt))
      .limit(1),
    db
      .select({
        id: notifications.id,
        event: notifications.event,
        accountId: notifications.accountId,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(isNull(notifications.sentAt), lte(notifications.createdAt, stuckCutoff)))
      // Oldest first: the message that has been waiting longest is the worst one.
      .orderBy(asc(notifications.createdAt))
      .limit(RECENT_LIMIT),
  ]);

  return {
    waiting: Number(waitingRows[0]?.n ?? 0),
    waitingOverADay: Number(waitingDayRows[0]?.n ?? 0),
    oldestWaitingAt: oldestRows[0]?.createdAt ?? null,
    recent: recentRows,
  };
}

/**
 * Store-webhook outcomes. Two distinct failures, both meaning "money moved and
 * the member may not have got what they paid for":
 *  - `account_id IS NULL`     — the event matched no account (unknown app user).
 *  - `tier_applied_at IS NULL` on a matched event — the handler never reached
 *    the point where it grants the plan (it is stamped even when the grant is
 *    deliberately skipped, so null means the flow broke, not that it declined).
 * Counted all-time on purpose: neither self-heals, so ageing them out of the
 * count would quietly hide a member who is still owed their plan.
 */
async function loadWebhooks(): Promise<WebhookHealth> {
  const db = getDb();
  const unmatchedWhere = isNull(revenuecatEvents.accountId);
  const neverAppliedWhere = and(
    isNotNull(revenuecatEvents.accountId),
    isNull(revenuecatEvents.tierAppliedAt),
  );

  const [unmatchedRows, neverAppliedRows, recentRows] = await Promise.all([
    db.select({ n: count() }).from(revenuecatEvents).where(unmatchedWhere),
    db.select({ n: count() }).from(revenuecatEvents).where(neverAppliedWhere),
    db
      .select({
        eventId: revenuecatEvents.eventId,
        type: revenuecatEvents.type,
        accountId: revenuecatEvents.accountId,
        tierAppliedAt: revenuecatEvents.tierAppliedAt,
        receivedAt: revenuecatEvents.receivedAt,
      })
      .from(revenuecatEvents)
      .where(or(isNull(revenuecatEvents.accountId), isNull(revenuecatEvents.tierAppliedAt)))
      .orderBy(desc(revenuecatEvents.receivedAt))
      .limit(RECENT_LIMIT),
  ]);

  return {
    unmatched: Number(unmatchedRows[0]?.n ?? 0),
    neverApplied: Number(neverAppliedRows[0]?.n ?? 0),
    recent: recentRows.map((r) => ({
      eventId: r.eventId,
      type: r.type,
      matched: r.accountId != null,
      tierApplied: r.tierAppliedAt != null,
      receivedAt: r.receivedAt,
    })),
  };
}

/**
 * Scheduled-job health from two independent sources:
 *
 *  - The audit log, for any `cron.*` action. A `cron.tick` row counts as a run
 *    of EVERY job, because the deployed schedule is one tick that runs all the
 *    scans. Windowed to the last 30 days so the time-ordered audit index does
 *    the work (an older run means "not running" anyway).
 *  - The notification outbox, for the last message each job actually produced.
 *
 * The audit column is empty until the cron routes record their runs; the
 * outbox column carries real signal today, which is why both are shown rather
 * than one confident-looking number.
 */
async function loadJobs(now: Date): Promise<JobHealth[]> {
  const db = getDb();
  const since = new Date(now.getTime() - JOB_LOOKBACK_DAYS * DAY_MS);
  const events = JOBS.map((j) => j.event).filter((e): e is string => e != null);

  const [cronRows, outputRows] = await Promise.all([
    db
      .select({
        action: auditLog.action,
        lastAt: sql<string | null>`to_char(max(${auditLog.createdAt}) at time zone 'UTC', ${sql.raw(ISO_UTC)})`,
      })
      .from(auditLog)
      .where(and(gte(auditLog.createdAt, since), like(auditLog.action, 'cron.%')))
      .groupBy(auditLog.action),
    db
      .select({
        event: notifications.event,
        lastAt: sql<string | null>`to_char(max(${notifications.createdAt}) at time zone 'UTC', ${sql.raw(ISO_UTC)})`,
      })
      .from(notifications)
      .where(and(gte(notifications.createdAt, since), inArray(notifications.event, events)))
      .groupBy(notifications.event),
  ]);

  const runByJob = new Map<string, Date>();
  let tickRunAt: Date | null = null;
  for (const row of cronRows) {
    const at = parseIso(row.lastAt);
    if (!at) continue;
    const key = normalizeJobKey(row.action);
    if (key === 'tick') {
      if (!tickRunAt || at > tickRunAt) tickRunAt = at;
      continue;
    }
    const current = runByJob.get(key);
    if (!current || at > current) runByJob.set(key, at);
  }

  const outputByEvent = new Map<string, Date>();
  for (const row of outputRows) {
    const at = parseIso(row.lastAt);
    if (at) outputByEvent.set(row.event, at);
  }

  return JOBS.map((job) => {
    const own = runByJob.get(normalizeJobKey(job.key)) ?? null;
    const lastRunAt =
      own && tickRunAt ? (own > tickRunAt ? own : tickRunAt) : (own ?? tickRunAt);
    return {
      key: job.key,
      label: job.label,
      what: job.what,
      lastRunAt,
      lastOutputAt: job.event ? (outputByEvent.get(job.event) ?? null) : null,
    };
  });
}

const STUCK_COLUMNS: Column<StuckNotification>[] = [
  { key: 'event', header: 'Message', render: (r) => humanize(r.event) },
  {
    key: 'account',
    header: 'Member',
    render: (r) => (
      <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
        {shortId(r.accountId)}
      </span>
    ),
  },
  {
    key: 'waiting',
    header: 'Waiting',
    align: 'right',
    render: (r) => (
      <span
        className="gt-numeric"
        style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
        title={r.createdAt.toISOString()}
      >
        {relativeTime(r.createdAt)}
      </span>
    ),
  },
];

const WEBHOOK_COLUMNS: Column<WebhookProblem>[] = [
  {
    key: 'problem',
    header: 'Problem',
    render: (r) =>
      !r.matched
        ? 'No matching member account'
        : !r.tierApplied
          ? 'Member matched, plan never granted'
          : 'Did not finish processing',
  },
  { key: 'type', header: 'Event', render: (r) => humanize(r.type) },
  {
    key: 'event',
    header: 'Store reference',
    render: (r) => (
      <span className="gt-numeric" style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
        {shortId(r.eventId)}
      </span>
    ),
  },
  {
    key: 'received',
    header: 'Received',
    align: 'right',
    render: (r) => (
      <span
        className="gt-numeric"
        style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
        title={r.receivedAt.toISOString()}
      >
        {relativeTime(r.receivedAt)}
      </span>
    ),
  },
];

const JOB_COLUMNS: Column<JobHealth>[] = [
  {
    key: 'job',
    header: 'Job',
    render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{r.label}</span>
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{r.what}</span>
      </div>
    ),
  },
  {
    key: 'lastRun',
    header: 'Last recorded run',
    align: 'right',
    render: (r) => (
      <span
        className="gt-numeric"
        style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
        title={r.lastRunAt ? r.lastRunAt.toISOString() : undefined}
      >
        {ago(r.lastRunAt)}
      </span>
    ),
  },
  {
    key: 'lastOutput',
    header: 'Last message sent',
    align: 'right',
    render: (r) => (
      <span
        className="gt-numeric"
        style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
        title={r.lastOutputAt ? r.lastOutputAt.toISOString() : undefined}
      >
        {ago(r.lastOutputAt)}
      </span>
    ),
  },
];

/** Small dim paragraph used under each card header. */
function Note({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 14px',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--gt-text-dim)',
        maxWidth: 720,
      }}
    >
      {children}
    </p>
  );
}

export default async function AdminSystemHealthPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has('analytics.read')) redirect('/admin');

  const now = new Date();
  const [outbox, webhooks, jobs] = await Promise.all([
    loadOutbox(now),
    loadWebhooks(),
    loadJobs(now),
  ]);

  const anyRecordedRun = jobs.some((j) => j.lastRunAt != null);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="System health"
        subtitle="Whether the background machinery is still doing its job: messages waiting to go out, app-store payments that did not land on an account, and the reminder jobs that run each day. Nothing on this page changes anything. Fix items from the queue that owns them."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile
          label="Messages waiting"
          value={outbox.waiting.toLocaleString()}
          hint={`over ${STUCK_AFTER_MINUTES} minutes old`}
        />
        <StatTile
          label="Waiting over a day"
          value={outbox.waitingOverADay.toLocaleString()}
          hint="retry has already missed these"
        />
        <StatTile
          label="Payments with no member"
          value={webhooks.unmatched.toLocaleString()}
          hint="store event matched no account"
        />
        <StatTile
          label="Payments with no plan"
          value={webhooks.neverApplied.toLocaleString()}
          hint="member matched, plan not granted"
        />
      </div>

      <Card padded={false} style={{ marginBottom: 24 }}>
        <CardHeader
          title="Messages waiting to send"
          action={
            <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>
              {outbox.oldestWaitingAt
                ? `Oldest ${relativeTime(outbox.oldestWaitingAt)}`
                : 'Nothing waiting'}
            </span>
          }
        />
        <div style={{ padding: 18 }}>
          <Note>
            Every message is saved before it is sent, so nothing is lost when a send fails. These
            are the ones still waiting; the daily retry picks them up automatically. A message
            waiting longer than a day has already survived one retry and needs a look.
          </Note>
          <DataTable
            columns={STUCK_COLUMNS}
            rows={outbox.recent}
            rowKey={(r) => r.id}
            empty="Every message has gone out."
          />
        </div>
      </Card>

      <Card padded={false} style={{ marginBottom: 24 }}>
        <CardHeader title="App-store payments that did not finish" />
        <div style={{ padding: 18 }}>
          <Note>
            When someone pays through the App Store or Google Play, the store tells us and we grant
            their plan. These payments never got that far: either we could not tell whose account
            they belonged to, or we matched the member but the plan was never granted. Each one is
            somebody who paid and may still be waiting. Grant the plan from Subscriptions once you
            have confirmed the purchase.
          </Note>
          <DataTable
            columns={WEBHOOK_COLUMNS}
            rows={webhooks.recent}
            rowKey={(r) => r.eventId}
            empty="Every store payment landed on an account."
          />
        </div>
      </Card>

      <Card padded={false}>
        <CardHeader title="Daily jobs" />
        <div style={{ padding: 18 }}>
          <Note>
            These run once a day and send the reminders members expect. &ldquo;Last message
            sent&rdquo; is the strongest evidence they are alive: a job that has been silent for
            days while members are due reminders is a job that has stopped.
            {anyRecordedRun
              ? ' “Last recorded run” comes from the audit log.'
              : ' “Last recorded run” shows a dash until the daily jobs start recording their runs in the audit log. Read the message column for now.'}
          </Note>
          <DataTable
            columns={JOB_COLUMNS}
            rows={jobs}
            rowKey={(r) => r.key}
            empty="No jobs configured."
          />
        </div>
      </Card>
    </div>
  );
}
