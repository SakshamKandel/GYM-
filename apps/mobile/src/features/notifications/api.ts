import { z } from 'zod';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@gym/shared';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

/**
 * Notification-center client (WP-14, Pack B/P) — a small, self-contained
 * fetcher for the GET/POST /api/notifications* family (WP-2's frozen
 * contract). Kept in its own feature module — same discipline as
 * features/support/api.ts — so the center screen depends on nothing outside
 * this module. Every call is bearer-token, zod-validated, and NEVER throws a
 * raw error: failures resolve to a typed `NotificationApiError` the screen
 * branches on.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type NotificationApiErrorCode = 'unauthorized' | 'not_found' | 'invalid' | 'network';

export class NotificationApiError extends Error {
  readonly code: NotificationApiErrorCode;
  constructor(code: NotificationApiErrorCode) {
    super(code);
    this.name = 'NotificationApiError';
    this.code = code;
  }
}

export function toNotificationError(err: unknown): NotificationApiError {
  return err instanceof NotificationApiError ? err : new NotificationApiError('network');
}

function statusToCode(status: number): NotificationApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid';
  return 'network';
}

async function call(opts: {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}${opts.path}`,
      {
        method: opts.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${opts.token}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new NotificationApiError('network');
  }
  if (!res.ok) throw new NotificationApiError(statusToCode(res.status));
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new NotificationApiError('network');
  return parsed.data;
}

// ── Inbox ─────────────────────────────────────────────────────

const notificationRowSchema = z.object({
  id: z.string(),
  event: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable().catch(null),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationRow = z.infer<typeof notificationRowSchema>;

const notificationsPageSchema = z.object({
  notifications: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): NotificationRow[] => {
      const parsed = notificationRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
  unreadCount: z.number().catch(0),
  nextOffset: z.number().nullable().catch(null),
});
export interface NotificationsPage {
  notifications: NotificationRow[];
  unreadCount: number;
  nextOffset: number | null;
}

/** GET /api/notifications?limit&offset → a page of the caller's own inbox. */
export async function getNotifications(
  token: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<NotificationsPage> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await call({ method: 'GET', path: `/api/notifications${query}`, token });
  return parse(notificationsPageSchema, data);
}

/** POST /api/notifications/[id]/read → mark one row read (idempotent). */
export async function markNotificationRead(id: string, token: string): Promise<void> {
  await call({ method: 'POST', path: `/api/notifications/${encodeURIComponent(id)}/read`, token });
}

/** POST /api/notifications/read-all → mark every unread row read. */
export async function markAllNotificationsRead(token: string): Promise<void> {
  await call({ method: 'POST', path: '/api/notifications/read-all', token });
}

// ── Preferences ───────────────────────────────────────────────

export type { NotificationCategory };
export { NOTIFICATION_CATEGORIES };

const prefsSchema = z.object({
  categories: z.record(z.string(), z.object({ push: z.boolean() })).catch({}),
  quietHoursStart: z.number().nullable().catch(null),
  quietHoursEnd: z.number().nullable().catch(null),
  availableCategories: z.array(z.string()).catch([...NOTIFICATION_CATEGORIES]),
});
export interface NotificationPrefsState {
  categories: Partial<Record<NotificationCategory, { push: boolean }>>;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

/** GET /api/notifications/prefs — default-all-on; a missing key reads as enabled. */
export async function getNotificationPrefs(token: string): Promise<NotificationPrefsState> {
  const data = await call({ method: 'GET', path: '/api/notifications/prefs', token });
  const parsed = parse(prefsSchema, data);
  return {
    categories: parsed.categories as NotificationPrefsState['categories'],
    quietHoursStart: parsed.quietHoursStart,
    quietHoursEnd: parsed.quietHoursEnd,
  };
}

/**
 * PUT /api/notifications/prefs — the categories map REPLACES the stored one
 * (send the FULL toggle state, not a partial patch); quiet hours are merged
 * field-by-field (omit a field to leave it as-is server-side).
 */
export async function putNotificationPrefs(
  patch: {
    categories?: Partial<Record<NotificationCategory, { push: boolean }>>;
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
  },
  token: string,
): Promise<NotificationPrefsState> {
  const data = await call({
    method: 'PUT',
    path: '/api/notifications/prefs',
    token,
    body: { ...patch },
  });
  const parsed = parse(prefsSchema, data);
  return {
    categories: parsed.categories as NotificationPrefsState['categories'],
    quietHoursStart: parsed.quietHoursStart,
    quietHoursEnd: parsed.quietHoursEnd,
  };
}
