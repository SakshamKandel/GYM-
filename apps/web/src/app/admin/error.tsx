'use client';

import { useEffect } from 'react';
import { Button } from '@/components/console';

/**
 * Client error boundary for the whole /admin subtree (D9). A transient Neon
 * error inside any console page used to render Next's raw, un-styled error
 * page; now the operator gets a calm in-console message and a working retry
 * (reset() re-renders the failed segment) plus a link back to the overview.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin console error:', error);
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
        This section failed to load. It’s usually a transient issue — try again in
        a moment.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <a
          href="/admin"
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
          Back to overview
        </a>
      </div>
    </div>
  );
}
