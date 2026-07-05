import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * A single left-nav destination. `match` decides the active state:
 *  - 'exact' → active only when pathname === href (use for index routes).
 *  - 'prefix' → active when pathname starts with href (use for sections).
 */
export interface NavItem {
  href: string;
  label: string;
  match?: 'exact' | 'prefix';
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.match === 'exact') return pathname === item.href;
  // Default prefix match, but avoid a bare index href (e.g. '/admin') matching
  // every sub-route — treat a href with no trailing segment as exact-ish.
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Shared console chrome for the admin + coach shells: fixed-width sidebar with
 * a brand label, role-filtered nav (active item painted the one accent red via
 * the .gt-nav-item token), and a footer showing the signed-in email + a Log out
 * button. Logout POSTs to /api/staff/logout and then redirects the browser to
 * this console's own login page (`loginHref`) — see LogoutButton. Server
 * component apart from that one client button; the caller passes the resolved
 * pathname so active state renders without client JS.
 *
 * `nav` items are pre-filtered by the caller (role gating lives in the layout),
 * so ConsoleShell renders exactly what it's given. `loginHref` is the console's
 * login route ('/admin/login' or '/coach/login').
 */
export function ConsoleShell({
  brand,
  nav,
  pathname,
  email,
  loginHref,
  children,
}: {
  brand: string;
  nav: NavItem[];
  pathname: string;
  email: string;
  loginHref: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 224,
          flexShrink: 0,
          borderRight: '1px solid var(--gt-border)',
          padding: '20px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '0 12px 18px',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: 'var(--gt-red)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 15,
              letterSpacing: '-0.01em',
            }}
          >
            {brand}
          </span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="gt-nav-item"
              data-active={isActive(item, pathname) ? 'true' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', padding: '0 12px' }}>
          <div
            style={{
              borderTop: '1px solid var(--gt-border)',
              paddingTop: 14,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--gt-text-dim)',
                marginBottom: 4,
              }}
            >
              Signed in
            </div>
            <div
              className="gt-numeric"
              style={{
                fontSize: 12,
                color: 'var(--gt-text)',
                wordBreak: 'break-all',
              }}
            >
              {email}
            </div>
          </div>
          <LogoutButton loginHref={loginHref} />
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px' }}>{children}</main>
    </div>
  );
}
