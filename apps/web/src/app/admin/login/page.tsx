import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoutButton } from '@/components/console';
import { StaffLogin } from '@/components/console/StaffLogin';
import { consoleMismatchFromCookie } from '@/lib/staffSession';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Admin sign-in. When the browser already carries a staff session that CANNOT
 * open this console (a coach, a restaurant, an account with no workspace yet),
 * the layout guard bounces it back here — so instead of showing the same empty
 * form again with no explanation, we say what happened and where that account
 * belongs. The notice is driven by the session, never by the submitted email,
 * so it only ever appears after a sign-in that worked.
 */
export default async function AdminLoginPage() {
  const mismatch = await consoleMismatchFromCookie('admin');

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
          <LogoutButton loginHref="/admin/login" />
        </div>
      </main>
    );
  }

  return (
    <StaffLogin
      portal="Admin"
      destination="/admin"
      description="Members, payments, partners, content and permissions, all in one place. Every change is recorded against your name."
      unauthorizedMessage="That email and password do not open an admin account."
    />
  );
}
