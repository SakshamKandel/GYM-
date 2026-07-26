'use client';

import { useCallback, useRef, type ReactNode } from 'react';

/**
 * Arrow keys for a queue.
 *
 * The console's tables already make each row focusable and openable with Enter,
 * which is the hard half. What was missing is the half an operator uses all
 * morning: getting from one row to the next without a full Tab traverse through
 * every link and button the row contains. On a payments queue that is a dozen
 * Tab presses per row.
 *
 * Wrap a table in this and Up / Down step between rows, Home and End jump to
 * the ends of the list. Nothing else changes: the row still opens with Enter or
 * Space, and the keys are only claimed when a row itself has focus, so typing
 * in a search field or moving through a link inside a row is untouched.
 *
 * Deliberately a wrapper rather than a change to the table: every queue gets
 * the behaviour by wrapping, and a table used outside a queue is unaffected.
 */
export function KeyboardRows({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const root = ref.current;
    if (!root) return;

    // Only when a ROW has focus. Anywhere else — a search box, a select, a
    // button inside a cell — these keys already mean something.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const row = active.closest('tr');
    if (!row || !root.contains(row) || row !== active) return;

    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr[tabindex="0"]'));
    const index = rows.indexOf(row as HTMLTableRowElement);
    if (index === -1) return;

    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[next]?.focus();
  }, []);

  return (
    // `display: contents` so wrapping a table adds behaviour and not a box —
    // the queue lays out exactly as it did before.
    <div ref={ref} onKeyDown={onKeyDown} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
