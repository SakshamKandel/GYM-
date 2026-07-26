/**
 * Line glyphs for the console sidebar.
 *
 * The sidebar can collapse to a 72px rail, and a rail of labelless rows is a
 * blank strip: nothing to aim at, nothing to recognise. Each nav item names one
 * of these instead, so the collapsed state stays navigable and the expanded
 * state gains a scanning anchor.
 *
 * All one family: 18px box, currentColor stroke at 1.5, round caps and joins,
 * no fills — so a glyph inherits the item's dim / active-accent colour with no
 * per-icon styling. Server-component friendly (no hooks, no client boundary):
 * a layout can build `<NavIcon />` elements and hand them to the client shell.
 */

/** Every glyph the console nav can ask for. */
export type NavIconName =
  | 'overview'
  | 'support'
  | 'applications'
  | 'payments'
  | 'receipt'
  | 'alert'
  | 'members'
  | 'coaches'
  | 'staff'
  | 'flag'
  | 'broadcast'
  | 'subscriptions'
  | 'pricing'
  | 'promos'
  | 'wallet'
  | 'calculator'
  | 'analytics'
  | 'orders'
  | 'calendar'
  | 'store'
  | 'content'
  | 'catalog'
  | 'gyms'
  | 'star'
  | 'trophy'
  | 'system'
  | 'audit';

/**
 * One `d` per glyph. Multi-stroke icons pack their subpaths into the same
 * string, which keeps the table one line per icon and the render a single
 * <path> — no per-icon component, nothing to drift.
 */
const PATHS: Record<NavIconName, string> = {
  overview: 'M3 3h5v5H3zM10 3h5v4h-5zM10 9h5v6h-5zM3 10h5v5H3z',
  support: 'M15 10.5A1.5 1.5 0 0 1 13.5 12H6l-3 3V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5z',
  applications:
    'M6.5 4.5h-1A1.5 1.5 0 0 0 4 6v7.5A1.5 1.5 0 0 0 5.5 15h7a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5h-1M7 3h4v3H7zM6.5 10l1.5 1.5 3.5-3.5',
  payments: 'M3 5h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 8h14',
  receipt: 'M4 3h10v12l-2.5-1.5L9 15l-2.5-1.5L4 15zM6.5 6.5h5M6.5 9.5h3',
  alert: 'M9 3l7 12H2zM9 7.5v3M9 12.7h.01',
  members:
    'M11.5 15v-1.5a3 3 0 0 0-3-3h-3a3 3 0 0 0-3 3V15M9.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M16 15v-1.5a3 3 0 0 0-2.2-2.9M11.5 3.6a3 3 0 0 1 0 4.8',
  coaches:
    'M10.5 15v-1.5a3 3 0 0 0-3-3h-3a3 3 0 0 0-3 3V15M8.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M12 8.5l1.5 1.5L16.5 7',
  staff: 'M9 2.5 3.5 5v4c0 3.2 2.3 5.6 5.5 6.5 3.2-.9 5.5-3.3 5.5-6.5V5z',
  flag: 'M4 15.5V3h8l-1.5 3L12 9H4',
  broadcast:
    'M3 7.5h2L13 4v10L5 10.5H3a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1zM5.5 11v2.5a1 1 0 0 0 2 0v-2',
  subscriptions: 'M14.5 8a5.5 5.5 0 0 0-9.6-3.2M3.5 10a5.5 5.5 0 0 0 9.6 3.2M5 2v3H2M13 16v-3h3',
  pricing:
    'M2.6 9.4 8.4 3.6a2 2 0 0 1 1.4-.6H14a1 1 0 0 1 1 1v4.2a2 2 0 0 1-.6 1.4l-5.8 5.8a1 1 0 0 1-1.4 0L2.6 10.8a1 1 0 0 1 0-1.4zM11.8 6.2h.01',
  promos:
    'M2.5 7V5.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V7a2 2 0 0 0 0 4v1.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V11a2 2 0 0 0 0-4zM7 6.5v1M7 8.5v1M7 10.5v1',
  wallet:
    'M3 5.5A1.5 1.5 0 0 1 4.5 4H14a1 1 0 0 1 1 1v1.5M3 5.5v7A1.5 1.5 0 0 0 4.5 14H14a1 1 0 0 0 1-1v-2M11.5 8.5h4v2.5h-4a1.25 1.25 0 0 1 0-2.5z',
  calculator:
    'M4.5 2.5h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM6 5.5h6M6 9h.01M9 9h.01M12 9h.01M6 12h.01M9 12h.01M12 12h.01',
  analytics: 'M3 15V8M7 15V4M11 15v-5M15 15V6',
  orders: 'M4 6h10l-.8 8.1a1 1 0 0 1-1 .9H5.8a1 1 0 0 1-1-.9zM6.5 6V4.5a2.5 2.5 0 0 1 5 0V6',
  calendar:
    'M3.5 4.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM2.5 7.5h13M6 2.5v3M12 2.5v3',
  store: 'M3 8v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8M2.5 8h13l-1-4.5h-11zM7 15v-4h4v4',
  content:
    'M3 5.5A1.5 1.5 0 0 1 4.5 4h9A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 12.5zM7.5 6.8 11.5 9l-4 2.2z',
  catalog: 'M4.5 6v6M2.5 7.5v3M13.5 6v6M15.5 7.5v3M4.5 9h9',
  gyms: 'M9 15.5c3.3-3.4 5-6 5-8a5 5 0 1 0-10 0c0 2 1.7 4.6 5 8zM10.6 6.4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  star: 'M9 2.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L9 12.6l-3.8 2 .7-4.2-3.1-3 4.3-.6z',
  trophy:
    'M5.5 3h7v3.5a3.5 3.5 0 0 1-7 0zM5.5 4.5H3.5v1a2 2 0 0 0 2 2M12.5 4.5h2v1a2 2 0 0 1-2 2M9 10v2.5M6.5 15h5l-.5-2.5h-4z',
  system: 'M2.5 9h3l2-5 3.5 10 2-5h2.5',
  audit: 'M6 4.5h9M6 9h9M6 13.5h9M3 4.5h.01M3 9h.01M3 13.5h.01',
};

/** A single 18px nav glyph. Inherits colour from the nav item around it. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
