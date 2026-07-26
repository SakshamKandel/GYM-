import { accounts, coachMessages, supportThreadStates } from '@gym/db';
import { and, countDistinct, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from './db';

/** Mirrors packages/db/src/schema.ts accounts.tier enum. */
export type Tier = 'starter' | 'silver' | 'gold' | 'elite';

/** Support-thread lifecycle status (plan §3 P1-11). Absence of a
 * `support_thread_states` row means an implicitly-'open' thread. */
export type SupportThreadStatus = 'open' | 'resolved';

export interface SupportThreadRow {
  account: {
    id: string;
    displayName: string;
    email: string;
    tier: Tier;
  };
  lastBody: string;
  lastAt: string;
  lastSender: 'user' | 'coach';
  unread: number;
  status: SupportThreadStatus;
  assignedTo: string | null;
  assignedToLabel: string | null;
  resolvedAt: string | null;
  /**
   * This member is sold priority support, so their ticket is answered first.
   * Derived from the tier by {@link isPrioritySupport} rather than re-decided
   * in the console, so the badge staff see and the order they see it in can
   * never disagree. Additive field — older readers simply ignore it.
   */
  priority: boolean;
}

/**
 * Elite is sold "your support messages get answered first" on the paywall, on
 * the pricing page and in the /support hero. That promise has to be true
 * somewhere, and this is the only place the staff inbox is ordered (the server
 * page and GET /api/admin/support/threads both read from here), so this is
 * where it is made true.
 *
 * Order is: tickets waiting on a reply, Elite before the rest of the ladder,
 * longest wait first. Nothing below Elite is SOLD priority; ordering the rest
 * of the ladder underneath it just keeps the list stable and sensible.
 */
const TIER_PRIORITY: Record<Tier, number> = { starter: 0, silver: 1, gold: 2, elite: 3 };

/** The tier that is actually sold a place at the front of the line. */
export function isPrioritySupport(tier: Tier): boolean {
  return tier === 'elite';
}

/**
 * The inbox order. Exported so a caller that assembles rows another way still
 * sorts them the one way staff are used to.
 *
 * 1. Waiting on staff first. A thread whose last inbound message is already
 *    read needs nothing from anyone, so it never outranks one that does.
 * 2. Then tier, Elite at the top — the paid promise.
 * 3. Then longest wait first WITHIN a tier, so an ordinary ticket cannot be
 *    pushed down forever by fresher ones next to it.
 *
 * Threads with nothing waiting keep the old newest-activity order untouched:
 * there is no line to be at the front of once everyone has been answered, so
 * tier does not get a say there.
 *
 * The old primary key was the unread COUNT, which quietly said five messages
 * from one person outrank one message from another. It does not; waiting or
 * not waiting is the real signal, and the tie is broken by who has waited
 * longest.
 */
export function compareSupportThreads(a: SupportThreadRow, b: SupportThreadRow): number {
  const aWaiting = a.unread > 0;
  const bWaiting = b.unread > 0;
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;

  const aAt = new Date(a.lastAt).getTime();
  const bAt = new Date(b.lastAt).getTime();
  if (!aWaiting) return bAt - aAt;

  const byTier = TIER_PRIORITY[b.account.tier] - TIER_PRIORITY[a.account.tier];
  return byTier !== 0 ? byTier : aAt - bAt;
}

export interface SupportThreadListFilter {
  /** 'all' (default) keeps both open and resolved threads. */
  status?: SupportThreadStatus | 'all';
  /** When set, keeps only threads assigned to this staff accountId. */
  assigneeId?: string;
}

/**
 * Loads every account with any 'support'-kind coach_messages activity, newest
 * message per account (DISTINCT ON), joined to its lifecycle state
 * (support_thread_states — LEFT JOIN because the row is created lazily, so
 * absence means an implicitly-'open', unassigned thread) and the assignee's
 * identity. Shared by GET /api/admin/support/threads and the server page so
 * both read the identical shape (documented "kept in sync deliberately"
 * pattern already used by this inbox, now centralized here instead of
 * hand-duplicated — see plan §2 A7 on matrix/query drift).
 *
 * No pagination — this inbox has always been a full-table scan (support
 * ticket volume is expected to stay small relative to the member base); the
 * `filter` is applied in JS after the single query, same cost class as the
 * {@link compareSupportThreads} sort that follows it.
 */
export async function loadSupportThreads(
  filter: SupportThreadListFilter = {},
): Promise<SupportThreadRow[]> {
  const db = getDb();
  const assignee = alias(accounts, 'support_thread_assignee');

  // The self-join alias is written out by hand rather than through drizzle's
  // `alias()`: inside a raw `sql` template an aliased table renders as its
  // ALIAS ONLY, so `from ${alias(coachMessages, 'cm2')}` emitted `from "cm2"`,
  // a relation that does not exist, and every load of this page failed with a
  // query error. Naming the table and its alias explicitly is the whole fix.
  // The outer reference stays a real column so the correlation is type-checked.
  const unread = sql<number>`(
    select count(*)::int
    from ${coachMessages} "cm2"
    where "cm2"."account_id" = ${coachMessages.accountId}
      and "cm2"."kind" = 'support'
      and "cm2"."sender" = 'user'
      and "cm2"."read_by_coach" = false
  )`;

  const rows = await db
    .selectDistinctOn([coachMessages.accountId], {
      lastBody: coachMessages.body,
      lastAt: coachMessages.createdAt,
      lastSender: coachMessages.sender,
      unread,
      account: {
        id: accounts.id,
        displayName: accounts.displayName,
        email: accounts.email,
        tier: accounts.tier,
      },
      status: supportThreadStates.status,
      assignedTo: supportThreadStates.assignedTo,
      resolvedAt: supportThreadStates.resolvedAt,
      assigneeDisplayName: assignee.displayName,
      assigneeEmail: assignee.email,
    })
    .from(coachMessages)
    .innerJoin(accounts, eq(coachMessages.accountId, accounts.id))
    .leftJoin(supportThreadStates, eq(supportThreadStates.accountId, coachMessages.accountId))
    .leftJoin(assignee, eq(assignee.id, supportThreadStates.assignedTo))
    .where(eq(coachMessages.kind, 'support'))
    .orderBy(coachMessages.accountId, desc(coachMessages.createdAt));

  let threads: SupportThreadRow[] = rows.map((r) => ({
    account: r.account,
    lastBody: r.lastBody,
    lastAt: r.lastAt.toISOString(),
    lastSender: r.lastSender as 'user' | 'coach',
    unread: r.unread,
    status: (r.status ?? 'open') as SupportThreadStatus,
    assignedTo: r.assignedTo,
    assignedToLabel: r.assignedTo
      ? r.assigneeDisplayName?.trim() || r.assigneeEmail || null
      : null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    priority: isPrioritySupport(r.account.tier),
  }));

  if (filter.status && filter.status !== 'all') {
    threads = threads.filter((t) => t.status === filter.status);
  }
  if (filter.assigneeId) {
    threads = threads.filter((t) => t.assignedTo === filter.assigneeId);
  }

  // DISTINCT ON forced accountId-first ordering above; re-sort for the console.
  return threads.sort(compareSupportThreads);
}

/**
 * How many support threads are waiting on staff — i.e. distinct accounts with
 * at least one member-sent 'support' message the console hasn't read yet.
 *
 * Deliberately a single COUNT(DISTINCT account_id) rather than
 * {@link loadSupportThreads}().length: the nav badge runs on EVERY admin page
 * render, so it must not pay for the inbox's per-account joins, unread
 * subquery and full row materialization. Same predicate the ops overview
 * already reports as `ops.unreadSupport` (GET /api/admin/overview), so the
 * badge and that tile can never disagree.
 *
 * Resolved threads are counted too: reopening is a staff action, so a member
 * replying to a closed ticket leaves it 'resolved' — filtering those out would
 * silently swallow exactly the follow-up this badge exists to surface.
 *
 * The predicate is served by the `coach_messages_support_unread` partial index
 * (packages/db) — unindexed it was a full scan of every message ever sent, on a
 * table that only ever grows.
 */
export async function countUnreadSupportThreads(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: countDistinct(coachMessages.accountId) })
    .from(coachMessages)
    .where(
      and(
        eq(coachMessages.kind, 'support'),
        eq(coachMessages.sender, 'user'),
        eq(coachMessages.readByCoach, false),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** How long the nav badge may lag the real count. */
const UNREAD_BADGE_TTL_MS = 30_000;

let unreadBadge: { at: number; value: number } | null = null;
let unreadBadgeInFlight: Promise<number> | null = null;

/**
 * {@link countUnreadSupportThreads} for the console CHROME — the sidebar pill
 * and the TopBar bell dot, which the admin layout renders on every single page.
 *
 * The layout wraps every admin route, so the exact count was being recomputed
 * for a staffer clicking through pricing, gyms or the audit log — none of which
 * are the support inbox. The number is the same for every viewer (it is a
 * queue depth, not personal data), so one short-lived result is shared by all
 * of them: a badge that is up to {@link UNREAD_BADGE_TTL_MS} behind is worth
 * far more than a query per page view. Concurrent renders share the in-flight
 * read rather than each starting their own, and a failed read is not cached, so
 * the next render simply tries again.
 *
 * The inbox itself never reads this — /admin/support loads real threads, so the
 * page a staffer opens to act on the queue is always exact.
 */
export async function countUnreadSupportThreadsCached(): Promise<number> {
  const cached = unreadBadge;
  if (cached && Date.now() - cached.at < UNREAD_BADGE_TTL_MS) return cached.value;
  if (!unreadBadgeInFlight) {
    unreadBadgeInFlight = countUnreadSupportThreads()
      .then((value) => {
        unreadBadge = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        unreadBadgeInFlight = null;
      });
  }
  return unreadBadgeInFlight;
}
