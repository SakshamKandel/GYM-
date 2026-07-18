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
 */
type Variant = 'primary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md';

export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  style,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const pad = size === 'sm' ? '6px 12px' : '10px 16px';
  const fontSize = size === 'sm' ? 13 : 15;

  const base = {
    padding: pad,
    fontSize,
    fontFamily: 'var(--font-heading)',
    fontWeight: 600,
    borderRadius: 10,
    cursor: rest.disabled ? 'default' : 'pointer',
    opacity: rest.disabled ? 0.5 : 1,
    lineHeight: 1.2,
    transition: 'background 120ms, border-color 120ms, color 120ms',
  } as const;

  const variantStyle =
    variant === 'primary'
      ? { background: 'var(--gt-accent-strong)', color: 'var(--gt-accent-ink)', border: 'none' }
      : variant === 'dark'
        ? { background: 'var(--gt-text)', color: 'var(--gt-surface)', border: 'none' }
        : variant === 'danger'
          ? {
              background: 'transparent',
              color: 'var(--gt-danger)',
              border: '1px solid color-mix(in srgb, var(--gt-danger) 38%, transparent)',
            }
          : {
              background: 'var(--gt-surface)',
              color: 'var(--gt-text)',
              border: '1px solid var(--gt-border-strong)',
            };

  return (
    <button {...rest} style={{ ...base, ...variantStyle, ...style }}>
      {children}
    </button>
  );
}
