'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * Labeled text input built on the .gt-input token. `label` renders a small
 * uppercase caption above; `hint` a dim helper below. Extends native <input>
 * props (value/onChange/placeholder/type…). For search, prefer <SearchField>.
 */
export function TextField({
  label,
  hint,
  id,
  style,
  ...rest
}: {
  label?: string;
  hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label ? (
        <span
          style={{
            fontSize: 12,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
          }}
        >
          {label}
        </span>
      ) : null}
      <input id={id} className="gt-input" style={style} {...rest} />
      {hint ? (
        <span style={{ fontSize: 12, color: 'var(--gt-text-dim)' }}>{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Search input with a leading magnifier glyph. Controlled via value/onChange
 * from the parent (usually filtering a client table). Full-width by default.
 */
export function SearchField({
  style,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--gt-text-dim)',
          fontSize: 14,
          pointerEvents: 'none',
        }}
      >
        ⌕
      </span>
      <input
        type="search"
        className="gt-input"
        style={{ paddingLeft: 32, ...style }}
        {...rest}
      />
    </div>
  );
}
