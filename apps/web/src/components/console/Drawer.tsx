'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { PanelHeader } from './PanelHeader';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Right-side detail panel. Controlled: parent owns `open` and passes `onClose`.
 * Renders a click-through scrim + a sliding panel; closes on Escape and scrim
 * click. `title` shows in the panel header with a close (×) button; `footer`
 * pins action buttons to the bottom. Slide honors prefers-reduced-motion.
 *
 * Returns null when closed (no DOM), so it's cheap to mount conditionally.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 440,
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
      aria-label={title ?? 'Detail panel'}
      style={{ position: 'fixed', inset: 0, zIndex: 50 }}
    >
      <div onClick={onClose} className="gt-scrim" />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width,
          maxWidth: '92vw',
          background: 'var(--gt-card)',
          borderLeft: '1px solid var(--gt-border)',
          boxShadow: 'var(--gt-shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'gt-drawer-in 160ms ease-out',
          outline: 'none',
        }}
      >
        <PanelHeader title={title} onClose={onClose} />
        <div style={{ padding: 'var(--gt-space-5)', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
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
