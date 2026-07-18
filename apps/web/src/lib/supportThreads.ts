import { accounts, coachMessages, supportThreadStates } from '@gym/db';
import { desc, eq, sql } from 'drizzle-orm';
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
 * existing unread-desc/recency sort.
 */
export async function loadSupportThreads(
  filter: SupportThreadListFilter = {},
): Promise<SupportThreadRow[]> {
  const db = getDb();
  const cm2 = alias(coachMessages, 'cm2');
  const assignee = alias(accounts, 'support_thread_assignee');

  const unread = sql<number>`(
    select count(*)::int
    from ${cm2}
    where ${cm2.accountId} = ${coachMessages.accountId}
      and ${cm2.kind} = 'support'
      and ${cm2.sender} = 'user'
      and ${cm2.readByCoach} = false
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
  }));

  if (filter.status && filter.status !== 'all') {
    threads = threads.filter((t) => t.status === filter.status);
  }
  if (filter.assigneeId) {
    threads = threads.filter((t) => t.assignedTo === filter.assigneeId);
  }

  // DISTINCT ON forced accountId-first ordering above; re-sort for the console.
  return threads.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });
}
