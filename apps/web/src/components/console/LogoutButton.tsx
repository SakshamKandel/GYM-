'use client';

import { useState } from 'react';

/**
 * Sign-out control for the console sidebar. POSTs to /api/staff/logout (which
 * deletes the session server-side and clears the httpOnly gt_staff cookie) then
 * sends the browser to the console's login page.
 *
 * The logout endpoint returns `{ ok: true }` JSON rather than a redirect, so a
 * plain <form> post would leave the browser sitting on that JSON body. This
 * client button awaits the POST and then navigates with a hard
 * `window.location.replace(loginHref)` — replace (not push) so Back doesn't
 * return to the now-deauthenticated console, and a full load so any cached
 * server components for the protected subtree are discarded. Even if the POST
 * fails we still redirect: the layout guard re-checks the cookie on the next
 * request, so the worst case is the login page bounces the user straight back
 * in — never a stuck state.
 *
 * `loginHref` is the console's own login route ('/admin/login' or
 * '/coach/login'), passed by ConsoleShell. `compact` renders an icon-only
 * button for the collapsed sidebar rail (same real sign-out behaviour).
 */
export function LogoutButton({
  loginHref,
  compact = false,
}: {
  loginHref: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/staff/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore — redirect regardless; the guard re-checks the cookie server-side.
    }
    window.location.replace(loginHref);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        aria-label="Log out"
        title="Log out"
        className="gt-nav-item"
        style={{
          width: 40,
          height: 40,
          margin: '0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--gt-surface)',
          border: '1px solid var(--gt-border)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M6 2H3v12h3M10 11l3-3-3-3M13 8H6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="gt-nav-item"
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'var(--gt-surface)',
        border: '1px solid var(--gt-border)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
        fontFamily: 'var(--font-heading)',
      }}
    >
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
