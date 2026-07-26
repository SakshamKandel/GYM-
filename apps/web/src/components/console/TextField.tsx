'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Labeled text input built on the .gt-input token. `label` renders a small
 * caption above; `hint` a dim helper below; `error` replaces the hint with a
 * danger-toned message and marks the field invalid. Extends native <input>
 * props (value/onChange/placeholder/type…). For search, prefer <SearchField>.
 *
 * The hint and the error are wired to the input with aria-describedby, so the
 * helper text is read out with the field rather than sitting next to it
 * unannounced.
 */
export function TextField({
  label,
  hint,
  error,
  id,
  style,
  ...rest
}: {
  label?: string;
  hint?: ReactNode;
  /** What went wrong, in plain words. Replaces the hint while it is set. */
  error?: string | null;
} & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const helpId = `${fieldId}-help`;
  const help = error ?? hint;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {label ? (
        <label
          htmlFor={fieldId}
          style={{
            fontSize: 'var(--gt-fs-micro)',
            letterSpacing: '0.03em',
            color: 'var(--gt-text-dim)',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
          }}
        >
          {label}
        </label>
      ) : null}
      <input
        id={fieldId}
        className="gt-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={help ? helpId : undefined}
        style={
          error
            ? { borderColor: 'var(--gt-danger)', ...style }
            : style
        }
        {...rest}
      />
      {help ? (
        <span
          id={helpId}
          style={{
            fontSize: 'var(--gt-fs-micro)',
            lineHeight: 1.4,
            color: error ? 'var(--gt-danger)' : 'var(--gt-text-dim)',
          }}
        >
          {help}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Search input with a leading magnifier glyph. Controlled via value/onChange
 * from the parent (usually filtering a client table). Full-width by default.
 *
 * The glyph is drawn, not typed: the ⌕ character it used to use renders at a
 * different size and baseline in every font that has it, and is missing from
 * several.
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
          color: 'var(--gt-text-faint)',
          display: 'inline-flex',
          pointerEvents: 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" focusable="false">
          <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        className="gt-input"
        style={{ paddingLeft: 36, ...style }}
        {...rest}
      />
    </div>
  );
}
