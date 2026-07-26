'use client';

import { useEffect } from 'react';
import { Button } from '@/components/console';

/**
 * Client error boundary for the whole /partner subtree, matching the admin one.
 *
 * Without it a transient failure inside any partner page fell through to the
 * app-wide error page — the full-screen marketing treatment, in the customer's
 * colours, with nothing on it a restaurant can use and no way back to the board
 * they were working. A kitchen mid-service needs the shell and one button. Now
 * it gets both, and reset() re-renders the failed segment.
 */
export default function PartnerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Partner portal error:', error);
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
        a moment. Your orders are safe.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <a
          href="/partner"
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
          Back to today’s orders
        </a>
      </div>
    </div>
  );
}
