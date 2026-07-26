'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { PanelHeader } from './PanelHeader';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
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
      <div onClick={onClose} className="gt-scrim" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="gt-card"
        style={{
          position: 'relative',
          width,
          maxWidth: '100%',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '86vh',
          outline: 'none',
          boxShadow: 'var(--gt-shadow-pop)',
        }}
      >
        <PanelHeader title={title} onClose={onClose} />
        <div style={{ padding: 'var(--gt-space-5)', overflowY: 'auto' }}>{children}</div>
        {footer ? (
          <div
            style={{
              padding: 'var(--gt-space-3) var(--gt-space-5)',
              borderTop: '1px solid var(--gt-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
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
