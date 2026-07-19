/**
 * Notifications pure logic — the event↔category taxonomy, the preference/quiet-
 * hours gate, and the cron idempotency-key format (Pack B; §7.2/§8.2). No I/O
 * (CLAUDE.md rule 10). `notify()` (WP-2) owns dispatch; this module owns the
 * decisions it makes: is this event's category enabled, are we inside quiet
 * hours, and what dedupe key does an at-least-once sender stamp.
 *
 * E3 (reusable consent store): categories are the stable unit a future
 * email/SMS/marketing opt-in plugs into behind the same prefs row.
 */

/** Top-level preference categories (the toggle unit in notification_prefs). */
export const NOTIFICATION_CATEGORIES = [
  'orders',
  'payments',
  'support',
  'coaching',
  'billing',
  'engagement',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Every notification event → its preference category. Adding an event here is
 * the ONLY place a new notification type is declared; the union type and the
 * prefs gate derive from it. `satisfies` keeps every value a real category.
 */
export const NOTIFICATION_EVENTS = {
  // Order comms (Pack A)
  order_placed_partner: 'orders',
  order_status: 'orders',
  order_cancelled_partner: 'orders',
  // Disputes / support (Pack E / Q)
  order_dispute_staff: 'support',
  support_message_staff: 'support',
  support_reply_member: 'support',
  gym_enquiry_staff: 'support',
  gym_report_staff: 'support',
  coach_message_staff: 'support',
  // Payments / payouts (Pack I / J)
  payment_request_staff: 'payments',
  payment_reviewed_member: 'payments',
  payout_status_partner: 'payments',
  // Coaching (Pack K / L)
  coach_application_staff: 'coaching',
  coach_message_client: 'coaching',
  coach_checkin: 'coaching',
  coach_unassigned: 'coaching',
  coach_milestone: 'coaching',
  // Billing lifecycle (Pack G / J — mostly cron-driven)
  trial_expiry: 'billing',
  renewal_nudge: 'billing',
  cycle_dunning: 'billing',
  tier_payment_submitted: 'billing',
  // Engagement (Pack O / N — cron-driven)
  day2_reengage: 'engagement',
  macro_nudge: 'engagement',
  streak_reminder: 'engagement',
} as const satisfies Record<string, NotificationCategory>;

/** The closed set of notification events every `notify()` call-site uses. */
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/** The preference category an event belongs to. */
export function notificationCategory(event: NotificationEvent): NotificationCategory {
  return NOTIFICATION_EVENTS[event];
}

// --- Preferences + quiet hours -----------------------------------------------

/** A member's notification preferences (mirrors notification_prefs). */
export interface NotificationPrefs {
  /** Per-category channel toggles. A missing category = enabled (default all-on). */
  categories: Partial<Record<NotificationCategory, { push: boolean }>>;
  /** Quiet-hours window as minutes-of-day (0-1439, KTM); null = no window. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

/** The all-on default used when an account has no prefs row yet. */
export function defaultNotificationPrefs(): NotificationPrefs {
  return { categories: {}, quietHoursStart: null, quietHoursEnd: null };
}

/** Is push enabled for a category? Missing prefs / missing key default to true. */
export function isCategoryPushEnabled(
  prefs: NotificationPrefs | null | undefined,
  category: NotificationCategory,
): boolean {
  const entry = prefs?.categories?.[category];
  return entry ? entry.push : true;
}

/** Is push enabled for a specific event (via its category)? */
export function isEventPushEnabled(
  prefs: NotificationPrefs | null | undefined,
  event: NotificationEvent,
): boolean {
  return isCategoryPushEnabled(prefs, notificationCategory(event));
}

/** Normalize any integer to a valid minute-of-day (0-1439). */
function normMinute(m: number): number {
  return ((Math.trunc(m) % 1440) + 1440) % 1440;
}

/**
 * Is `nowMinutes` inside the quiet-hours window? Handles a window that wraps
 * midnight (start > end, e.g. 22:00→07:00). A null endpoint or a zero-length
 * window (start === end) means "no quiet hours" → false.
 */
export function isWithinQuietHours(
  startMinutes: number | null | undefined,
  endMinutes: number | null | undefined,
  nowMinutes: number,
): boolean {
  if (startMinutes == null || endMinutes == null) return false;
  const start = normMinute(startMinutes);
  const end = normMinute(endMinutes);
  const now = normMinute(nowMinutes);
  if (start === end) return false; // zero-length window
  if (start < end) return now >= start && now < end; // same-day
  return now >= start || now < end; // wraps midnight
}

/** What `notify()` should do for an event given prefs + the current time. */
export interface NotificationDelivery {
  writeInbox: boolean;
  sendPush: boolean;
}

/**
 * The delivery decision (§8.2): a disabled category drops entirely (no inbox, no
 * push); inside quiet hours the durable inbox row is still written but the push
 * is suppressed (no end-of-window storm — the inbox IS the record); otherwise
 * both. `nowMinutes` is the recipient's KTM minute-of-day.
 */
export function notificationDelivery(
  prefs: NotificationPrefs | null | undefined,
  event: NotificationEvent,
  nowMinutes: number,
): NotificationDelivery {
  if (!isEventPushEnabled(prefs, event)) return { writeInbox: false, sendPush: false };
  const quiet = isWithinQuietHours(prefs?.quietHoursStart, prefs?.quietHoursEnd, nowMinutes);
  return { writeInbox: true, sendPush: !quiet };
}

// --- Idempotency -------------------------------------------------------------

/**
 * The dedupe key an at-least-once (cron / double-fire-prone) sender stamps so a
 * re-run is a no-op via the `notifications.dedupeKey` partial unique. Format
 * `event:accountId:scope` — e.g. `trial_expiry:{accountId}:{yyyy-mm-dd}` — one
 * per account per scope window.
 */
export function cronDedupeKey(
  event: NotificationEvent,
  accountId: string,
  scope: string,
): string {
  return `${event}:${accountId}:${scope}`;
}
