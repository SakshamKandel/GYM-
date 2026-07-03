'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

/**
 * Centered modal dialog — an alternative to <Drawer> for short forms and
 * confirmations. Controlled via `open` / `onClose`; closes on Escape and scrim
 * click. `title` heads the card; `footer` pins actions bottom-right. Returns
 * null when closed.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Dialog'}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
      />
      <div
        className="gt-card"
        style={{
          position: 'relative',
          width,
          maxWidth: '100%',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '86vh',
        }}
      >
        {title ? (
          <div
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--gt-border)',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {title}
          </div>
        ) : null}
        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>
        {footer ? (
          <div
            style={{
              padding: 18,
              borderTop: '1px solid var(--gt-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
