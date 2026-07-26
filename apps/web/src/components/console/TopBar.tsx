'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * Sticky console top bar (64px). It answers one question — where am I — and
 * then gets out of the way.
 *
 * The left side reads as a trail: the console name in quiet ink, a hairline
 * separator, then the current section in full strength. Two levels is the whole
 * hierarchy; anything deeper belongs in the page's own header, not in the
 * chrome. The right side carries only what an operator needs from every route:
 * the page's actions, the notifications bell, and who they are signed in as.
 *
 * The search box is rendered ONLY when a console wires `onSearch` (focus with
 * ⌘K / Ctrl-K, clear with Esc). It used to render unconditionally, so every
 * page in all three consoles shipped a search field — keyboard hint and all —
 * that could not search anything: the most prominent control in the chrome did
 * nothing on every route. A control that looks primary and does nothing is
 * worse than no control, so it now appears with its handler or not at all.
 * `actions` is where a page-level primary (e.g. Export) or a "+" quick-add is
 * injected by the shell; when omitted, no dead buttons render.
 *
 * Client component: keyboard shortcut + controlled input.
 */
export function TopBar({
  email,
  title,
  context,
  searchPlaceholder = 'Search…',
  onSearch,
  actions,
  notificationsHref,
  hasNotifications = false,
  onToggleSidebar,
}: {
  email: string;
  /** The section the current route belongs to, e.g. "Meal orders". */
  title?: string;
  /**
   * The console this section sits in, e.g. "Admin". Rendered before the title
   * as a quiet parent crumb; dropped on narrow widths where the section name
   * alone is worth more than its context.
   */
  context?: string;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  actions?: ReactNode;
  notificationsHref?: string;
  hasNotifications?: boolean;
  /** Shown as a menu button on narrow widths where the sidebar is off-canvas. */
  onToggleSidebar?: () => void;
}) {
  const [q, setQ] = useState('');
  const [isApple, setIsApple] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const searchable = onSearch != null;

  useEffect(() => {
    if (!searchable) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchable]);

  // The hint told every operator to press ⌘K, including the ones on Windows
  // where the shortcut is Ctrl-K. Read after mount so the server and the first
  // client render still agree.
  useEffect(() => {
    setIsApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  }, []);

  const initials = initialsOf(email);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: 'var(--gt-topbar-h)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: onToggleSidebar ? '0 12px' : '0 20px',
        background: 'color-mix(in srgb, var(--gt-surface) 88%, transparent)',
        backdropFilter: 'saturate(1.4) blur(8px)',
        borderBottom: '1px solid var(--gt-border)',
      }}
    >
      {onToggleSidebar ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Show menu"
          className="gt-icon-btn"
          data-bare="true"
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

      {searchable ? (
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 440, minWidth: 0 }}>
          <label htmlFor={searchId} className="gt-sr-only">
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
              pointerEvents: 'none',
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
            className="gt-search-input"
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
          />
          {q === '' ? (
            <kbd aria-hidden className="gt-kbd" style={kbdPosition}>
              {isApple ? '⌘K' : 'Ctrl K'}
            </kbd>
          ) : null}
        </div>
      ) : title ? (
        <nav
          aria-label="Breadcrumb"
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            fontFamily: 'var(--font-heading)',
            fontSize: 15,
            letterSpacing: '-0.01em',
          }}
        >
          {context && context !== title ? (
            <>
              <span
                style={{
                  color: 'var(--gt-text-faint)',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                {context}
              </span>
              <span aria-hidden style={{ color: 'var(--gt-border-strong)' }}>
                /
              </span>
            </>
          ) : null}
          <span
            aria-current="page"
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 600,
              color: 'var(--gt-text)',
            }}
          >
            {title}
          </span>
        </nav>
      ) : null}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {actions}
        {notificationsHref ? (
          <Link
            href={notificationsHref}
            aria-label={hasNotifications ? 'Notifications, some unread' : 'Notifications'}
            title="Notifications"
            className="gt-icon-btn"
            data-bare="true"
            style={{ position: 'relative' }}
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
                className="gt-status-dot"
                data-tone="accent"
                style={{
                  position: 'absolute',
                  top: 9,
                  right: 10,
                  border: '1.5px solid var(--gt-surface)',
                  width: 9,
                  height: 9,
                }}
              />
            ) : null}
          </Link>
        ) : null}
        <span
          role="img"
          aria-label={`Signed in as ${email}`}
          title={email}
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--gt-radius-pill)',
            background: 'var(--gt-surface-hover)',
            border: '1px solid var(--gt-border-strong)',
            color: 'var(--gt-text-dim)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: '0.02em',
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      </div>
    </header>
  );
}

/**
 * Two letters from the address rather than its first two characters, so
 * `a.sharma@…` reads AS instead of A. — the old slice turned every dotted
 * address into a letter and a full stop.
 */
function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  if (parts.length === 0) return email.slice(0, 2).toUpperCase() || '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const kbdPosition: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  pointerEvents: 'none',
};
