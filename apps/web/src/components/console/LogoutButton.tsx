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

  // Sign out is the last thing anyone came here to do, so it reads as one more
  // quiet nav row rather than a bordered button competing with the destinations
  // above it. It picks up .gt-nav-item's hover, pressed and focus states.
  const glyph = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden focusable="false">
      <path
        d="M7 2.5H4A1.5 1.5 0 0 0 2.5 4v10A1.5 1.5 0 0 0 4 15.5h3M11.5 12l3.5-3-3.5-3M15 9H7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        aria-label={busy ? 'Signing out' : 'Log out'}
        aria-busy={busy || undefined}
        title="Log out"
        className="gt-nav-item"
        style={{
          width: 48,
          margin: '0 auto',
          justifyContent: 'center',
          padding: '9px 0',
          background: 'transparent',
          border: 'none',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {glyph}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      aria-busy={busy || undefined}
      className="gt-nav-item"
      style={{
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
        fontFamily: 'var(--font-heading)',
      }}
    >
      {glyph}
      <span>{busy ? 'Signing out…' : 'Log out'}</span>
    </button>
  );
}
