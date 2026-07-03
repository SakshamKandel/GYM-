'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Console button. Three variants:
 *  - primary: the ONE red action (maps to .gt-btn-primary token).
 *  - ghost: hairline-bordered neutral action.
 *  - danger: destructive; outlined in critical-red text, filled on hover.
 * Only ONE red-filled primary should sit in a given view. For destructive
 * flows prefer ConfirmButton (2-step). Extends native <button> props.
 */
type Variant = 'primary' | 'ghost' | 'danger';
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
      ? { background: 'var(--gt-red)', color: '#fff', border: 'none' }
      : variant === 'danger'
        ? {
            background: 'transparent',
            color: '#ff8178',
            border: '1px solid rgba(255,107,96,0.35)',
          }
        : {
            background: 'transparent',
            color: 'var(--gt-text)',
            border: '1px solid var(--gt-border)',
          };

  return (
    <button {...rest} style={{ ...base, ...variantStyle, ...style }}>
      {children}
    </button>
  );
}
