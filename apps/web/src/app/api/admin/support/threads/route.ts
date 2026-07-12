import { accounts, coachMessages } from '@gym/db';
import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Admin console — support inbox: one row per account with any 'support'
 * thread activity (SCALE-UP-PLAN §4.4).
 *
 *  - GET → DISTINCT ON (account) newest 'support' message per account, joined
 *    to the account's identity, each carrying `unread` — inbound (sender=
 *    'user') rows not yet `readByCoach`. There is no separate ticket-state
 *    column (§2 note): unread IS "open work". One query, no N+1 — the count
 *    is a correlated subquery against a self-alias of coach_messages, and the
 *    "last message" fields ride the same DISTINCT ON row. Sorted unread-desc,
 *    then most-recent-first (re-sorted in JS: DISTINCT ON forces ORDER BY to
 *    start with the account column, same idiom as coach/check-ins).
 *
 * Guarded by requirePermission('support.thread.read') — support_admin +
 * super/main_admin. Org-wide, no ownership scoping: support tickets are not
 * assigned to a specific coach.
 */

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'support.thread.read');
  if (principal instanceof Response) return principal;

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

  // DISTINCT ON forced accountId-first ordering above; re-sort for the console.
  const threads = rows.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });

  return json({ threads }, 200);
}
