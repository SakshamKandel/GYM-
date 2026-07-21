'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * Sticky console top bar (64px). Holds a page-scoped search (focus with ⌘K /
 * Ctrl-K, clear with Esc), an optional actions slot on the right, a
 * notifications bell (links to a provided href, with an unread dot), and an
 * avatar cluster showing the signed-in initials.
 *
 * The search is deliberately presentational chrome by default: it emits its
 * value through `onSearch` when the console wires a handler, and otherwise just
 * holds local text — it never fabricates results. `actions` is where a page-
 * level primary (e.g. Export) or a "+" quick-add is injected by the shell; when
 * omitted, no dead buttons render.
 *
 * Client component: keyboard shortcut + controlled input.
 */
export function TopBar({
  email,
  searchPlaceholder = 'Search…',
  onSearch,
  actions,
  notificationsHref,
  hasNotifications = false,
  onToggleSidebar,
}: {
  email: string;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  actions?: ReactNode;
  notificationsHref?: string;
  hasNotifications?: boolean;
  /** Shown as a menu button on narrow widths where the sidebar is off-canvas. */
  onToggleSidebar?: () => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: 64,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: onToggleSidebar ? '0 12px' : '0 24px',
        background: 'color-mix(in srgb, var(--gt-surface) 88%, transparent)',
        backdropFilter: 'saturate(1.4) blur(8px)',
        borderBottom: '1px solid var(--gt-border)',
      }}
    >
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          style={iconControl}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none">
            <path
              d="M3 5h12M3 9h12M3 13h12"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}

      {/* search */}
      <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 440, minWidth: 0 }}>
        <label htmlFor={searchId} className="gt-sr-only" style={srOnly}>
          Search
        </label>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--gt-text-faint)',
            display: 'inline-flex',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <input
          id={searchId}
          ref={inputRef}
          type="search"
          value={q}
          placeholder={searchPlaceholder}
          onChange={(e) => {
            setQ(e.target.value);
            onSearch?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQ('');
              onSearch?.('');
              e.currentTarget.blur();
            }
          }}
          style={{
            width: '100%',
            height: 40,
            padding: '0 12px 0 34px',
            borderRadius: 10,
            border: '1px solid var(--gt-border)',
            background: 'var(--gt-surface-sunken)',
            color: 'var(--gt-text)',
            fontSize: 14,
            fontFamily: 'var(--font-heading)',
          }}
        />
        <kbd
          aria-hidden
          className="hidden sm:inline-block"
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 11,
            fontFamily: 'var(--font-numeric)',
            color: 'var(--gt-text-faint)',
            border: '1px solid var(--gt-border-strong)',
            borderRadius: 6,
            padding: '1px 6px',
            background: 'var(--gt-surface)',
          }}
        >
          ⌘K
        </kbd>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {actions}
        {notificationsHref ? (
          <Link
            href={notificationsHref}
            aria-label={hasNotifications ? 'Notifications, unread' : 'Notifications'}
            style={{ ...iconControl, position: 'relative', textDecoration: 'none' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path
                d="M9 2a4 4 0 0 0-4 4v3l-1.5 2.5h11L13 9V6a4 4 0 0 0-4-4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M7.5 14a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {hasNotifications ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 7,
                  right: 8,
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--gt-accent)',
                  border: '1.5px solid var(--gt-surface)',
                }}
              />
            ) : null}
          </Link>
        ) : null}
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: 'var(--gt-accent-weak)',
            color: 'var(--gt-accent-strong)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 13,
            flexShrink: 0,
          }}
          title={email}
        >
          {initials}
        </span>
      </div>
    </header>
  );
}

const iconControl: React.CSSProperties = {
  width: 40,
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  border: '1px solid var(--gt-border)',
  background: 'var(--gt-surface)',
  color: 'var(--gt-text-dim)',
  cursor: 'pointer',
  flexShrink: 0,
};

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
