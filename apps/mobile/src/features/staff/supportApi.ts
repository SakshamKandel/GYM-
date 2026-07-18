import { z } from 'zod';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';

/**
 * Staff console — support inbox API client (SCALE-UP-PLAN §4.4 / §5.3).
 *
 * A sibling of features/staff/api.ts, NOT an edit to it — this workstream owns
 * the support surface exclusively, so it gets its own file + own request
 * plumbing against the SAME host (mirrors the client.ts/staff-api.ts split).
 * Same philosophy as the rest of the app: zod at the boundary, typed error
 * codes, nothing throws a raw error.
 *
 *  Error codes:
 *   'unauthorized' → 401 (no/expired session token)
 *   'forbidden'    → 403 (signed in, but lacks 'support.thread.read'/'.reply')
 *   'invalid'      → 400 (validation rejected the request body)
 *   'rate_limited' → 429 (too many requests — distinct from a bare network
 *                    failure so the UI can show "slow down" copy)
 *   'network'      → offline, non-JSON, or a malformed/unexpected response
 */

export type SupportErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'rate_limited'
  | 'network';

export class SupportApiError extends Error {
  readonly code: SupportErrorCode;

  constructor(code: SupportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SupportApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to SupportApiError (anything else = network). */
export function toSupportError(err: unknown): SupportApiError {
  return err instanceof SupportApiError ? err : new SupportApiError('network');
}

// ── Schemas ───────────────────────────────────────────────────

const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']);

const supportAccountSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  tier: tierSchema,
});

const threadStatusSchema = z.enum(['open', 'resolved']);
export type SupportThreadStatus = z.infer<typeof threadStatusSchema>;

const supportThreadRowSchema = z.object({
  account: supportAccountSchema,
  lastBody: z.string().catch(''),
  lastAt: z.string(),
  lastSender: z.enum(['user', 'coach']),
  unread: z.number().catch(0),
  // Lifecycle state (P1-11) — additive. An older server that omits these
  // resolves to the implicit default (open/unassigned) rather than nuking
  // the whole row, matching how the schema models absence.
  status: threadStatusSchema.catch('open'),
  assignedTo: z.string().nullable().catch(null),
});
export type SupportThreadRow = z.infer<typeof supportThreadRowSchema>;

/** Resilient list: drop unparseable rows rather than blanking the whole inbox. */
const supportThreadsSchema = z.object({
  threads: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): SupportThreadRow[] => {
      const parsed = supportThreadRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const supportMessageSchema = z.object({
  id: z.string(),
  sender: z.enum(['user', 'coach']),
  senderAccountId: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

/** Resilient: drop unparseable rows rather than blanking the whole thread. */
const supportMessagesSchema = z.object({
  messages: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): SupportMessage[] => {
      const parsed = supportMessageSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

// ── Fetch plumbing ────────────────────────────────────────────

interface SupportRequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

/** Every support-inbox call gives up after this long (defect H2: the inbox
 * used a bare `fetch` with no bound, so a hung connection could freeze the
 * screen on "Loading…" forever). */
const SUPPORT_REQUEST_TIMEOUT_MS = 15_000;

function statusToCode(status: number): SupportErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'invalid';
  if (status === 429) return 'rate_limited';
  return 'network';
}

async function supportRequest(opts: SupportRequestOptions): Promise<unknown> {
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
      SUPPORT_REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new SupportApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }

  throw new SupportApiError(statusToCode(res.status));
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new SupportApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Endpoints ─────────────────────────────────────────────────

export interface SupportThreadFilters {
  /** 'open' | 'resolved' | 'all' (server default is 'all'). */
  status?: SupportThreadStatus | 'all';
  /** Only 'mine' is meaningful server-side — keeps threads assigned to the caller. */
  assignee?: 'mine';
}

/**
 * GET /api/admin/support/threads?status=&assignee= → the inbox, unread-first
 * then newest-first. Omitting `status` returns every thread regardless of
 * lifecycle state (the server default is 'all', not 'open').
 */
export async function getAdminSupportThreads(
  token: string,
  filters: SupportThreadFilters = {},
): Promise<SupportThreadRow[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.assignee) params.set('assignee', filters.assignee);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await supportRequest({
    method: 'GET',
    path: `/api/admin/support/threads${query}`,
    token,
  });
  return parse(supportThreadsSchema, data).threads;
}

/**
 * POST /api/admin/support/threads/[accountId]/resolve (or .../reopen) — no
 * body on either. `resolved:true` moves the thread out of the default open
 * queue; `resolved:false` reopens it. `unread` remains the actual work
 * signal — resolving/reopening never touches it. Requires
 * `support.thread.reply`.
 */
export async function resolveSupportThread(
  accountId: string,
  resolved: boolean,
  token: string,
): Promise<void> {
  await supportRequest({
    method: 'POST',
    path: `/api/admin/support/threads/${encodeURIComponent(accountId)}/${resolved ? 'resolve' : 'reopen'}`,
    token,
  });
}

/**
 * POST /api/admin/support/threads/[accountId]/assign {assigneeId} → assigns
 * the thread to a staff account, or unassigns it when `staffAccountId` is
 * `null`. A non-null id must resolve to an existing staff account
 * ('invalid' otherwise). Drives the "assigned to me" filter. Requires
 * `support.thread.reply`.
 */
export async function assignSupportThread(
  accountId: string,
  staffAccountId: string | null,
  token: string,
): Promise<void> {
  await supportRequest({
    method: 'POST',
    path: `/api/admin/support/threads/${encodeURIComponent(accountId)}/assign`,
    token,
    body: { assigneeId: staffAccountId },
  });
}

/**
 * GET /api/admin/support/threads/[accountId] → that account's support thread,
 * oldest → newest. Read-only (F2) — marking the thread read is a separate call,
 * see markAdminSupportThreadRead.
 */
export async function getAdminSupportThread(
  accountId: string,
  token: string,
): Promise<SupportMessage[]> {
  const data = await supportRequest({
    method: 'GET',
    path: `/api/admin/support/threads/${encodeURIComponent(accountId)}`,
    token,
  });
  return parse(supportMessagesSchema, data).messages;
}

/**
 * POST /api/admin/support/threads/[accountId]/read (no body) → marks every
 * inbound message on this thread readByCoach=true, clearing its unread badge
 * in the inbox list (F2: mark-read was split out of GET into its own POST so
 * a GET-CSRF can't silently clear the work queue). Callers should invoke this
 * after successfully loading a thread; best-effort — a failure here shouldn't
 * block the thread from displaying, so callers may choose to swallow errors.
 */
export async function markAdminSupportThreadRead(
  accountId: string,
  token: string,
): Promise<void> {
  await supportRequest({
    method: 'POST',
    path: `/api/admin/support/threads/${encodeURIComponent(accountId)}/read`,
    token,
  });
}

const supportReplyEnvelope = z.object({ message: supportMessageSchema });

/**
 * POST /api/admin/support/threads/[accountId] {body} → staff reply. Returns
 * the inserted row. 'invalid' for an empty/too-long body, 'forbidden' without
 * 'support.thread.reply'.
 */
export async function replyToSupportThread(
  accountId: string,
  body: string,
  token: string,
): Promise<SupportMessage> {
  const data = await supportRequest({
    method: 'POST',
    path: `/api/admin/support/threads/${encodeURIComponent(accountId)}`,
    token,
    body: { body },
  });
  return parse(supportReplyEnvelope, data).message;
}
