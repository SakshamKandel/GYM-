'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { isActive, type NavGroup, SidebarNav } from './SidebarNav';
import { TopBar } from './TopBar';

/** Re-export nav types so consumers can import them from ConsoleShell/index. */
export type { NavItem, NavGroup } from './SidebarNav';

const COLLAPSE_KEY = 'gt.sidebar.collapsed';

/**
 * The label of the nav item the current route belongs to — the LONGEST matching
 * href wins, so /admin/gyms/reports names itself rather than its parent. Feeds
 * the top bar so it says where the operator is; falls back to the console name
 * for routes with no nav entry (a detail page, a redirect landing).
 */
function sectionTitle(groups: NavGroup[], pathname: string, brand: string): string {
  let best: { href: string; label: string } | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (!isActive(item, pathname)) continue;
      if (best === null || item.href.length > best.href.length) best = item;
    }
  }
  return best?.label ?? brand;
}

/**
 * Shared console chrome for the admin / coach / partner shells. Composes the
 * grouped {@link SidebarNav} and the sticky {@link TopBar} around the routed
 * page content.
 *
 * The whole frame is a client component so the collapse toggle can drive BOTH
 * the sidebar width and the content offset from one piece of state (no
 * hydration jump), and persist the choice to localStorage. Server-rendered
 * `children` are passed straight through as a prop, so pages stay server
 * components — the client boundary is only the frame, not the routes inside it.
 *
 * Responsive: below 960px the sidebar becomes an off-canvas drawer toggled from
 * the TopBar menu button, with a scrim. `groups` are pre-filtered by the caller
 * (permission gating lives in the layout); this renders exactly what it's given.
 */
export function ConsoleShell({
  brand,
  groups,
  pathname,
  email,
  loginHref,
  notificationsHref,
  hasNotifications,
  children,
}: {
  brand: string;
  groups: NavGroup[];
  pathname: string;
  email: string;
  loginHref: string;
  notificationsHref?: string;
  hasNotifications?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  // Restore persisted collapse choice after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch {
      /* localStorage unavailable — default expanded */
    }
  }, []);

  // Track the off-canvas breakpoint.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const sidebar = (
    <SidebarNav
      brand={brand}
      groups={groups}
      pathname={pathname}
      email={email}
      loginHref={loginHref}
      collapsed={!isNarrow && collapsed}
      onToggle={toggleCollapse}
    />
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--gt-bg)' }}>
      <a href="#gt-main" className="gt-skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar (in-flow). Hidden when narrow — drawer takes over. */}
      {!isNarrow ? sidebar : null}

      {/* Off-canvas drawer for narrow viewports. */}
      {isNarrow && mobileOpen ? (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            aria-hidden
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(16, 17, 18, 0.48)',
              backdropFilter: 'blur(4px)',
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              zIndex: 41,
              height: '100vh',
              maxWidth: '84vw',
              boxShadow: 'var(--gt-shadow-pop)',
            }}
          >
            {sidebar}
          </div>
        </>
      ) : null}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar
          email={email}
          title={sectionTitle(groups, pathname, brand)}
          notificationsHref={notificationsHref}
          hasNotifications={hasNotifications}
          onToggleSidebar={isNarrow ? () => setMobileOpen((o) => !o) : undefined}
        />
        <main id="gt-main" className="gt-console-main">
          {children}
        </main>
      </div>
    </div>
  );
}
