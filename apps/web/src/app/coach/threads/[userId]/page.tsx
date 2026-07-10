import { accounts, coachMessages } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TierChip } from '@/components/console';
import { requireCoachOwnsUser } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { MessageList, type ThreadMessage } from '../../_components/MessageList';
import { ReplyBox } from '../../_components/ReplyBox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ userId: string }>;
}

/**
 * A single client's coach_chat thread — the human side of the mobile Elite
 * chat. Ownership is guarded by requireCoachOwnsUser (notFound() when the coach
 * isn't assigned — we hide existence rather than surface a 403 in the UI). The
 * history renders with mobile-mirrored bubble sides (client right / coach left)
 * and a sticky reply composer that POSTs to the coach reply API.
 */
export default async function CoachThreadPage({ params }: PageProps) {
  const { userId } = await params;

  const coach = await staffFromCookie();
  if (!coach) redirect('/coach/login');

  const owns = await requireCoachOwnsUser(coach, userId);
  if (!owns) notFound();

  const db = getDb();

  const userRows = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
    })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) notFound();

  const messageRows = await db
    .select({
      id: coachMessages.id,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
    })
    .from(coachMessages)
    .where(
      and(eq(coachMessages.accountId, userId), eq(coachMessages.kind, 'coach_chat')),
    )
    .orderBy(asc(coachMessages.createdAt));

  // Clear the coach-side unread flag on the inbound rows we just loaded so the
  // inbox unread badge and 'Awaiting reply' / 'Unread messages' counts clear on
  // open — mirrors GET /api/coach/threads/[userId].
  await db
    .update(coachMessages)
    .set({ readByCoach: true })
    .where(
      and(
        eq(coachMessages.accountId, userId),
        eq(coachMessages.kind, 'coach_chat'),
        eq(coachMessages.sender, 'user'),
        eq(coachMessages.readByCoach, false),
      ),
    );

  const messages: ThreadMessage[] = messageRows.map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    createdAt: new Date(m.createdAt),
  }));

  const monogram = (user.displayName || user.email).charAt(0).toUpperCase();

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link
          href="/coach"
          className="gt-numeric"
          style={{
            fontSize: 12,
            color: 'var(--gt-text-dim)',
            textDecoration: 'none',
          }}
        >
          ← Inbox
        </Link>
      </div>

      {/* Client header — sticky so the identity stays visible while scrolling. */}
      <header
        className="gt-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            background: 'var(--gt-bg)',
            border: '1px solid var(--gt-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 16,
            color: 'var(--gt-text-dim)',
          }}
        >
          {monogram}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 18,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.displayName || user.email}
            </h1>
            <TierChip tier={user.tier} />
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--gt-text-dim)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.email}
          </div>
        </div>
        <span
          className="gt-numeric"
          style={{ fontSize: 12, color: 'var(--gt-text-dim)', flexShrink: 0 }}
        >
          {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </span>
      </header>

      <MessageList messages={messages} />

      <ReplyBox userId={user.id} />
    </div>
  );
}
