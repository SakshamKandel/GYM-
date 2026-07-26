'use client';

import { useCallback, useRef } from 'react';
import { FilterPill, FilterPills } from '@/components/console';

/**
 * The row of choices above a queue: Pending / Approved / All, Open / Resolved,
 * Balances / Payouts.
 *
 * Eight pages had each written their own, and they had drifted apart in the
 * ways hand-rolled controls always do. Several filled the chosen tab with
 * `--gt-accent`, which fails contrast against the white label it carries;
 * `--gt-accent-strong` is the one accent fill that passes, and the shared pill
 * uses it. Most were around 30px tall against a 44px minimum. None had a
 * pressed state. None could be moved through with the arrow keys, and a
 * counted tab put its number in the middle of a proportional font so the digits
 * jittered as the queue drained.
 *
 * This is that row, once. The look, the target size and the hover, pressed,
 * focus and disabled states all come from the shared FilterPill, so they cannot
 * drift again. Counts are tabular. Left and right (and Home and End) move
 * between choices, which is what a keyboard operator reaches for after landing
 * on the first one.
 *
 * Semantics are a pressed-toggle group rather than an ARIA tablist: the pills
 * narrow a list that is already on the page, they do not swap panels, and every
 * pill stays in the tab order so nothing is reachable only by arrow key.
 */
export interface QueueTab<T extends string> {
  key: T;
  label: string;
  /** Shown after the label. Omit rather than passing 0 to hide the count. */
  count?: number;
  /** Greyed and unreachable — e.g. while a decision on this view is in flight. */
  disabled?: boolean;
}

export function QueueTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  tone = 'accent',
}: {
  /** Names the group for screen readers, e.g. "Filter payments". */
  label: string;
  tabs: readonly QueueTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /**
   * 'accent' is the filter look. Use 'neutral' on a view whose single accent is
   * already spent on a primary action, so the page keeps one focal point.
   */
  tone?: 'accent' | 'neutral';
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const group = groupRef.current;
    if (!group) return;
    const pills = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const index = pills.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? pills.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + pills.length) % pills.length;
    pills[next]?.focus();
  }, []);

  return (
    // `display: contents` so this exists only to catch the key events — it
    // takes no box, and a tab row drops into a Toolbar slot laying out exactly
    // as the bare pill group did.
    <div ref={groupRef} onKeyDown={onKeyDown} style={{ display: 'contents' }}>
      <FilterPills label={label}>
        {tabs.map((tab) => (
          <FilterPill
            key={tab.key}
            tone={tone}
            selected={value === tab.key}
            disabled={tab.disabled}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="gt-numeric" style={{ fontSize: 12 }}>
                {tab.count}
              </span>
            )}
          </FilterPill>
        ))}
      </FilterPills>
    </div>
  );
}
