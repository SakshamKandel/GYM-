import { accounts } from '@gym/db';
import { effectiveTier } from '@gym/shared';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TierChip } from '@/components/console';
import { requireCoachOwnsUser } from '@/lib/authz';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { ClientDetail } from './_components/ClientDetail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Coach console — the CLIENT-DETAIL HUB (Pack K / WP-10). The missing "front
 * door" a desktop coach needs: a single page to review a client's data
 * (training log, weight/EWMA trend, PRs, check-in history) and act on them
 * (assign workout/diet, log a milestone, keep a private note, open the chat) —
 * all from the browser instead of only the mobile staff console.
 *
 * The server component owns identity + the ownership guard (notFound() when the
 * coach isn't assigned — existence is hidden, not surfaced as a 403). Every
 * data panel and every write is a same-origin fetch from the client component
 * to a coach API route this package owns, each of which re-runs the same guard.
 */
export default async function CoachClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  const { principal: coach } = await requireCoachPage('coach.user.read');
  if (!(await requireCoachOwnsUser(coach, id))) notFound();

  const [user] = await getDb()
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      email: accounts.email,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
    })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (!user) notFound();

  const tier = effectiveTier(user.tier, user.tierExpiresAt, new Date());
  const name = user.displayName || user.email;

  return (
    <div style={{ maxWidth: 940, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link
          href="/coach/clients"
          className="gt-numeric"
          style={{ fontSize: 12, color: 'var(--gt-text-dim)', textDecoration: 'none' }}
        >
          ← Clients
        </Link>
      </div>

      <header
        className="gt-card"
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}
      >
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 11,
            background: 'var(--gt-bg)',
            border: '1px solid var(--gt-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 18,
            color: 'var(--gt-text-dim)',
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 20,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </h1>
            <TierChip tier={tier} />
            {user.status === 'suspended' ? (
              <span style={{ fontSize: 12, color: 'var(--gt-red)' }}>Suspended</span>
            ) : null}
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
        <Link
          href={`/coach/threads/${user.id}`}
          className="gt-numeric"
          style={{
            flexShrink: 0,
            fontSize: 13,
            textDecoration: 'none',
            color: 'var(--gt-text)',
            border: '1px solid var(--gt-border)',
            borderRadius: 8,
            padding: '8px 12px',
          }}
        >
          Open chat
        </Link>
      </header>

      <ClientDetail userId={user.id} />
    </div>
  );
}
