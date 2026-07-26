'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Segmented filter control — the row of toggles that sits above a queue or a
 * table ("Open / Resolved / All", "Pending / Paid", "House / Coach").
 *
 * Every console page hand-rolled this button, and they drifted: some filled the
 * selected pill with --gt-accent (3.5:1 against the white label, which fails
 * AA) and some with --gt-accent-strong (5.1:1, which passes), while all of them
 * landed around 30px tall. This is the one implementation, so neither can
 * happen again: the look, the passing accent and the 44px touch target all come
 * from the `.gt-pill` rules in globals.css.
 *
 * `selected` drives `aria-pressed`, so the state is announced as well as drawn.
 * `tone` recolours the SELECTED fill for a control whose choices carry meaning
 * rather than just narrowing a list — the staff permission editor's Grant /
 * Deny, where green and red are the whole point and an accent fill would say
 * nothing. 'accent' (the default) stays the filter look; 'neutral' is the quiet
 * "nothing special here" fill.
 *
 * Extends native <button> props; `style` is merged last for one-off layout
 * tweaks (e.g. `flex: 1`).
 */
export function FilterPill({
  selected = false,
  tone = 'accent',
  children,
  className,
  ...rest
}: {
  selected?: boolean;
  tone?: 'accent' | 'neutral' | 'positive' | 'critical';
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={selected}
      data-tone={tone}
      className={className ? `gt-pill ${className}` : 'gt-pill'}
    >
      {children}
    </button>
  );
}

/**
 * Wrapper for a row of {@link FilterPill}s — wraps on narrow widths and keeps
 * the gap consistent with the Toolbar rhythm. `label` names the group for
 * screen readers (e.g. "Filter orders").
 */
export function FilterPills({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {children}
    </div>
  );
}
