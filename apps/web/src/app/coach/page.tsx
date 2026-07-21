import { accounts, coachAssignments, coachMessages } from '@gym/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { EmptyState, PageHeader, StatTile } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { type InboxUser, UserRow } from './_components/UserRow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach inbox. Server component: resolves the signed-in coach from the
 * 'gt_staff' cookie (the layout already guards, but we re-resolve to get the id
 * and fail safe if reached directly), lists their ACTIVE-assigned users with a
 * tier chip, last coach_chat message preview, relative time, and an unread
 * badge. Ordered unread-first, then by most recent activity.
 */
async function loadInbox(coachId: string): Promise<InboxUser[]> {
  const db = getDb();

  // Per-user aggregates over the coach_chat thread. accountId on coach_messages
  // IS the user's account id, so we group by it. Unread (coach side) = messages
  // the USER sent that the coach hasn't read.
  const agg = db
    .select({
      accountId: coachMessages.accountId,
      lastAt: sql<Date>`max(${coachMessages.createdAt})`.as('last_at'),
      unread: sql<number>`
        count(*) filter (
          where ${coachMessages.sender} = 'user' and ${coachMessages.readByCoach} = false
        )
      `.as('unread'),
    })
    .from(coachMessages)
    .where(eq(coachMessages.kind, 'coach_chat'))
    .groupBy(coachMessages.accountId)
    .as('agg');

  const rows = await db
    .select({
      userId: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
      lastAt: agg.lastAt,
      unread: agg.unread,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(accounts.id, coachAssignments.userId))
    .leftJoin(agg, eq(agg.accountId, accounts.id))
    .where(
      and(
        eq(coachAssignments.coachId, coachId),
        eq(coachAssignments.status, 'active'),
      ),
    );

  if (rows.length === 0) return [];

  // Latest coach_chat body per assigned user for the preview. One extra query
  // keeps the aggregate simple and index-friendly.
  const userIds = rows.map((r) => r.userId);
  const previews = await db
    .select({
      accountId: coachMessages.accountId,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
    })
    .from(coachMessages)
    .where(
      and(
        eq(coachMessages.kind, 'coach_chat'),
        inArray(coachMessages.accountId, userIds),
      ),
    )
    .orderBy(coachMessages.accountId, desc(coachMessages.createdAt));

  // First row per accountId is the newest (ordered desc within each group).
  const previewByUser = new Map<string, { sender: 'user' | 'coach'; body: string }>();
  for (const p of previews) {
    if (!previewByUser.has(p.accountId)) {
      previewByUser.set(p.accountId, { sender: p.sender, body: p.body });
    }
  }

  const list: InboxUser[] = rows.map((r) => {
    const preview = previewByUser.get(r.userId) ?? null;
    return {
      userId: r.userId,
      displayName: r.displayName,
      email: r.email,
      tier: r.tier,
      lastMessagePreview: preview?.body ?? null,
      lastMessageSender: preview?.sender ?? null,
      lastMessageAt: r.lastAt ? new Date(r.lastAt) : null,
      unreadCount: Number(r.unread ?? 0),
    };
  });

  // Unread-first, then most recent activity, then name for stability.
  list.sort((a, b) => {
    if (a.unreadCount > 0 !== b.unreadCount > 0) return a.unreadCount > 0 ? -1 : 1;
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    if (bt !== at) return bt - at;
    return a.displayName.localeCompare(b.displayName);
  });

  return list;
}

export default async function CoachInboxPage() {
  const { principal: coach } = await requireCoachPage('coach.user.read');

  const users = await loadInbox(coach.id);
  const totalUnread = users.reduce((sum, u) => sum + u.unreadCount, 0);
  const awaiting = users.filter((u) => u.unreadCount > 0).length;

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader
        title="Inbox"
        subtitle="Your assigned clients and their conversations. Unread threads rise to the top."
      />

      <div className="gt-grid-3" style={{ marginBottom: 22 }}>
        <StatTile label="Clients" value={users.length} />
        <StatTile
          label="Awaiting reply"
          value={awaiting}
          hint={awaiting === 0 ? 'all clear' : undefined}
        />
        <StatTile label="Unread messages" value={totalUnread} />
      </div>

      {users.length === 0 ? (
        <EmptyState
          title="No clients assigned yet"
          description="Once an admin assigns clients to you, their threads appear here — newest and unread first."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((u) => (
            <UserRow key={u.userId} user={u} />
          ))}
        </div>
      )}
    </div>
  );
}
