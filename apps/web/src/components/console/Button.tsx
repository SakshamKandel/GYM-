'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Console button. Four variants:
 *  - primary: the ONE accent action per view (maps to --gt-accent).
 *  - ghost: hairline-bordered neutral action.
 *  - danger: destructive; outlined in danger text, filled on hover.
 *  - dark: high-emphasis neutral fill (near-black on light) for a secondary
 *    call-to-action that shouldn't spend the single accent slot.
 * Only ONE accent-filled primary should sit in a given view. For destructive
 * flows prefer ConfirmButton (2-step). Extends native <button> props.
 *
 * All of the look lives in the `.gt-btn` rules in globals.css, keyed off
 * `data-variant` / `data-size`. It has to: hover, :active and :disabled cannot
 * be written as an inline style, which is why this control used to have no
 * pressed or hover feedback at all despite documenting one. Sizing (48px, or
 * 44px at `sm`) comes from the same place, so every console button clears the
 * touch-target minimum.
 *
 * `style` is still merged last and inline styles beat the stylesheet, so a
 * per-call override (a one-off colour, a full-width action) keeps winning.
 */
type Variant = 'primary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md';

export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  style,
  className,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      data-variant={variant}
      data-size={size}
      className={className ? `gt-btn ${className}` : 'gt-btn'}
      style={style}
    >
      {children}
    </button>
  );
}
