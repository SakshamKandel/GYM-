import { accounts, coachAssignments, coachMessages } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { and, eq, sql } from 'drizzle-orm';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { type Client, ClientCard } from './ClientCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in coach's ACTIVE-assigned clients. Server component: joins
 * coach_assignments (status='active', coachId = me) to accounts for identity,
 * with two correlated aggregates over the user's coach_chat thread —
 *   - unread: inbound (sender='user') messages the coach hasn't read.
 *   - lastActiveAt: the newest message the USER sent (their last touch of the
 *     thread), used as a lightweight "last active" signal without a new table.
 * Ordered unread-first, then most recently active, then name.
 */
async function loadClients(coachId: string): Promise<Client[]> {
  const db = getDb();

  const unread = sql<number>`(
    select count(*)::int
    from ${coachMessages}
    where ${coachMessages.accountId} = ${accounts.id}
      and ${coachMessages.kind} = 'coach_chat'
      and ${coachMessages.sender} = 'user'
      and ${coachMessages.readByCoach} = false
  )`;

  const lastActiveAt = sql<Date | null>`(
    select max(${coachMessages.createdAt})
    from ${coachMessages}
    where ${coachMessages.accountId} = ${accounts.id}
      and ${coachMessages.kind} = 'coach_chat'
      and ${coachMessages.sender} = 'user'
  )`;

  const rows = await db
    .select({
      userId: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      unread,
      lastActiveAt,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(coachAssignments.userId, accounts.id))
    .where(
      and(eq(coachAssignments.coachId, coachId), eq(coachAssignments.status, 'active')),
    );

  const now = new Date();
  const clients: Client[] = rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    email: r.email,
    // Effective tier — a lapsed dated subscription must show as 'starter'
    // here, same as everywhere else tier is auth-gated (raw accounts.tier
    // would drift for expired members).
    tier: effectiveTier(r.tier, r.tierExpiresAt, now),
    status: r.status,
    unread: Number(r.unread ?? 0),
    lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt) : null,
  }));

  clients.sort((a, b) => {
    if (a.unread > 0 !== b.unread > 0) return a.unread > 0 ? -1 : 1;
    const at = a.lastActiveAt?.getTime() ?? 0;
    const bt = b.lastActiveAt?.getTime() ?? 0;
    if (bt !== at) return bt - at;
    return (a.displayName || a.email).localeCompare(b.displayName || b.email);
  });

  return clients;
}

export default async function CoachClientsPage() {
  const { principal: coach } = await requireCoachPage('coach.user.read');

  const clients = await loadClients(coach.id);
  const totalUnread = clients.reduce((sum, c) => sum + c.unread, 0);

  const subtitle =
    clients.length === 0
      ? 'No clients are assigned to you yet.'
      : `${clients.length} ${clients.length === 1 ? 'client' : 'clients'}` +
        (totalUnread > 0 ? ` · ${totalUnread} unread` : '');

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader title="Clients" subtitle={subtitle} />

      {clients.length === 0 ? (
        <div
          className="gt-card"
          style={{ padding: 32, textAlign: 'center', color: 'var(--gt-text-dim)' }}
        >
          <div style={{ fontSize: 15, marginBottom: 6, color: 'var(--gt-text)' }}>
            No clients yet
          </div>
          <div style={{ fontSize: 14 }}>
            When an admin assigns clients to you, they will appear here with their
            latest activity and unread counts.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}
        >
          {clients.map((c) => (
            <ClientCard key={c.userId} client={c} />
          ))}
        </div>
      )}
    </div>
  );
}
