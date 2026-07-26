'use client';

import { useEffect } from 'react';
import { Button } from '@/components/console';

/**
 * Client error boundary for the whole /coach subtree, matching the admin one.
 *
 * Without it a transient failure inside any coach page fell through to the
 * app-wide error page — the full-screen marketing treatment, in the customer's
 * colours, with nothing on it a coach can use and no way back into the console
 * they were working in. Now the shell stays, the message is calm, and reset()
 * re-renders the failed segment so a hiccup costs one click.
 */
export default function CoachError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Coach console error:', error);
  }, [error]);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '48px auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: 20,
          color: 'var(--gt-text)',
          margin: 0,
        }}
      >
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: 'var(--gt-text-dim)', margin: 0 }}>
        This section failed to load. It’s usually a transient issue, so try again in
        a moment.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <a
          href="/coach"
          className="gt-nav-item"
          style={{
            fontSize: 13,
            padding: '8px 14px',
            border: '1px solid var(--gt-border)',
            borderRadius: 8,
            textDecoration: 'none',
            color: 'var(--gt-text)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          Back to your inbox
        </a>
      </div>
    </div>
  );
}
