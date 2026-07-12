import { accounts, coachMessages } from '@gym/db';
import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { SupportInbox } from './_components/SupportInbox';
import type { SupportThreadRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to view the support inbox. Mirrors the 'support.thread.read'
 * grant in authz.ts (support_admin + super/main_admin). The admin layout
 * already hides the nav link and guards the subtree, but we re-check here so
 * hitting the URL directly still fails safe.
 */
const CAN_READ: readonly StaffRole[] = ['super_admin', 'main_admin', 'support_admin'];

/**
 * Loads the same shape as GET /api/admin/support/threads (kept in sync
 * deliberately — this page reads the DB directly rather than calling its own
 * API, matching the convention already used by admin/payments and
 * admin/coaches). One account per row: the newest 'support' message
 * (DISTINCT ON), joined to the account's identity, with an unread count via a
 * correlated subquery against a self-alias of coach_messages.
 */
async function loadThreads(): Promise<SupportThreadRow[]> {
  const db = getDb();
  const cm2 = alias(coachMessages, 'cm2');

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
    })
    .from(coachMessages)
    .innerJoin(accounts, eq(coachMessages.accountId, accounts.id))
    .where(eq(coachMessages.kind, 'support'))
    .orderBy(coachMessages.accountId, desc(coachMessages.createdAt));

  const threads: SupportThreadRow[] = rows.map((r) => ({
    account: r.account,
    lastBody: r.lastBody,
    lastAt: r.lastAt.toISOString(),
    lastSender: r.lastSender as 'user' | 'coach',
    unread: r.unread,
  }));

  // DISTINCT ON forced accountId-first ordering above; re-sort for the console.
  return threads.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });
}

export default async function AdminSupportPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_READ.includes(principal.role)) redirect('/admin');

  const threads = await loadThreads();
  const awaiting = threads.filter((t) => t.unread > 0).length;
  const totalUnread = threads.reduce((sum, t) => sum + t.unread, 0);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Support"
        subtitle="Every account with a support ticket, unread first. Open a thread to read and reply."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Threads" value={threads.length} />
        <StatTile label="Awaiting reply" value={awaiting} hint={awaiting === 0 ? 'all clear' : undefined} />
        <StatTile label="Unread messages" value={totalUnread} />
      </div>

      <SupportInbox threads={threads} />
    </div>
  );
}
