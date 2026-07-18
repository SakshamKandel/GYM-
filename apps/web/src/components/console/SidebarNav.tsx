'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * A single left-nav destination. `match` decides the active state:
 *  - 'exact' → active only when pathname === href (use for index routes).
 *  - 'prefix' (default) → active when pathname starts with href.
 * `badge` renders a small count pill (e.g. Support unread); `icon` is an
 * optional leading glyph node shown in both expanded and collapsed states.
 */
export interface NavItem {
  href: string;
  label: string;
  match?: 'exact' | 'prefix';
  badge?: number;
  icon?: ReactNode;
}

/** A labelled cluster of nav items. `label` omitted → an unlabelled group. */
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Grouped, collapsible console sidebar. Brand block on top, micro-uppercase
 * group labels, an accent active-pill (3px left indicator via .gt-nav-item),
 * a Support-style badge, and a footer with the signed-in email + Log out.
 *
 * Collapse: a caret at the brand row toggles a 72px icon-rail; the choice is
 * persisted in localStorage under `gt.sidebar.collapsed` by the parent
 * (ConsoleShell) — this component is presentational and receives the boolean +
 * a toggle callback so the collapsed width can also drive the main-content
 * offset without a hydration jump.
 *
 * Client component (Link + interactive toggle), but active state is computed
 * from the `pathname` prop the server passed, so it renders correctly on first
 * paint.
 */
export function SidebarNav({
  brand,
  groups,
  pathname,
  email,
  loginHref,
  collapsed,
  onToggle,
}: {
  brand: string;
  groups: NavGroup[];
  pathname: string;
  email: string;
  loginHref: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      aria-label="Primary"
      style={{
        width: collapsed ? 72 : 248,
        flexShrink: 0,
        borderRight: '1px solid var(--gt-border)',
        background: 'var(--gt-surface)',
        padding: collapsed ? '18px 10px' : '20px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        position: 'sticky',
        top: 0,
        height: '100vh',
        transition: 'width 140ms ease',
      }}
    >
      {/* brand + collapse toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: collapsed ? '0 2px 16px' : '0 8px 16px',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {!collapsed ? (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              minWidth: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                background: 'var(--gt-accent)',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--gt-accent-ink)',
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {brand.charAt(0)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {brand}
            </span>
          </span>
        ) : (
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: 'var(--gt-accent)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--gt-accent-ink)',
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {brand.charAt(0)}
          </span>
        )}
        {!collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            aria-expanded={!collapsed}
            style={iconBtn}
          >
            <Chevron dir="left" />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          aria-expanded={!collapsed}
          style={{ ...iconBtn, alignSelf: 'center', marginBottom: 6 }}
        >
          <Chevron dir="right" />
        </button>
      ) : null}

      <nav
        aria-label="Console sections"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: 1,
          minHeight: 0,
        }}
      >
        {groups.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`} style={{ marginBottom: 8 }}>
            {group.label && !collapsed ? (
              <div className="gt-nav-group-label">{group.label}</div>
            ) : null}
            {group.label && collapsed && gi > 0 ? (
              <div
                aria-hidden
                style={{
                  height: 1,
                  background: 'var(--gt-border)',
                  margin: '8px 6px',
                }}
              />
            ) : null}
            {group.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="gt-nav-item"
                  data-active={active ? 'true' : undefined}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  style={collapsed ? { justifyContent: 'center', padding: '9px 0' } : undefined}
                >
                  {item.icon ? (
                    <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>
                      {item.icon}
                    </span>
                  ) : null}
                  {!collapsed ? (
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.label}
                    </span>
                  ) : null}
                  {item.badge != null && item.badge > 0 ? (
                    <Badge collapsed={collapsed} count={item.badge} />
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* footer: signed-in identity + logout */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {!collapsed ? (
          <div
            style={{
              borderTop: '1px solid var(--gt-border)',
              paddingTop: 12,
              marginBottom: 10,
              padding: '12px 8px 0',
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--gt-text-dim)',
                marginBottom: 4,
              }}
            >
              Signed in
            </div>
            <div
              className="gt-numeric"
              style={{ fontSize: 12, color: 'var(--gt-text)', wordBreak: 'break-all' }}
            >
              {email}
            </div>
          </div>
        ) : null}
        {!collapsed ? (
          <div style={{ padding: '0 8px' }}>
            <LogoutButton loginHref={loginHref} />
          </div>
        ) : (
          <LogoutButton loginHref={loginHref} compact />
        )}
      </div>
    </aside>
  );
}

function Badge({ count, collapsed }: { count: number; collapsed: boolean }) {
  const text = count > 99 ? '99+' : String(count);
  if (collapsed) {
    return (
      <span
        aria-label={`${count} unread`}
        style={{
          position: 'absolute',
          top: 6,
          right: 10,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: 'var(--gt-accent)',
        }}
      />
    );
  }
  return (
    <span
      aria-label={`${count} unread`}
      className="gt-numeric"
      style={{
        marginLeft: 'auto',
        minWidth: 20,
        textAlign: 'center',
        padding: '1px 6px',
        borderRadius: 999,
        background: 'var(--gt-accent-weak)',
        color: 'var(--gt-accent-strong)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={dir === 'left' ? 'M10 4 L6 8 L10 12' : 'M6 4 L10 8 L6 12'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const iconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid var(--gt-border)',
  background: 'var(--gt-surface)',
  color: 'var(--gt-text-dim)',
  cursor: 'pointer',
  flexShrink: 0,
};
