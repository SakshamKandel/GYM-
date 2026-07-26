import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoutButton } from '@/components/console';
import { StaffLogin } from '@/components/console/StaffLogin';
import { consoleMismatchFromCookie } from '@/lib/staffSession';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Restaurant sign-in. When the browser already carries a staff session that
 * CANNOT open this portal, the layout guard bounces it back here — so instead
 * of showing the same empty form again with no explanation, we say what
 * happened and where that account belongs. The notice is driven by the session,
 * never by the submitted email, so it only ever appears after a sign-in that
 * worked.
 */
export default async function PartnerLoginPage() {
  const mismatch = await consoleMismatchFromCookie('partner');

  if (mismatch) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--gt-bg)',
          color: 'var(--gt-text)',
        }}
      >
        <div
          className="gt-card"
          style={{
            width: 'min(100%, 520px)',
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 22 }}>
            {mismatch.title}
          </h1>
          <p style={{ margin: 0, color: 'var(--gt-text-dim)', fontSize: 16, lineHeight: 1.6 }}>
            {mismatch.body}
          </p>
          <Link className="gt-btn" data-variant="primary" href={mismatch.action.href}>
            {mismatch.action.label}
          </Link>
          <LogoutButton loginHref="/partner/login" />
        </div>
      </main>
    );
  }

  return (
    <StaffLogin
      portal="Partner"
      destination="/partner"
      description="Cook today’s orders, keep the menu right, look after your weekly meal plans, and see what you have earned."
      unauthorizedMessage="That email and password do not open a restaurant account."
    />
  );
}
