import { z } from 'zod';
import { BASE_URL } from '../../lib/api/client';

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
 *   'network'      → offline, non-JSON, or a malformed/unexpected response
 */

export type SupportErrorCode = 'unauthorized' | 'forbidden' | 'invalid' | 'network';

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

const supportThreadRowSchema = z.object({
  account: supportAccountSchema,
  lastBody: z.string().catch(''),
  lastAt: z.string(),
  lastSender: z.enum(['user', 'coach']),
  unread: z.number().catch(0),
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

function statusToCode(status: number): SupportErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'invalid';
  return 'network';
}

async function supportRequest(opts: SupportRequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
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

/** GET /api/admin/support/threads → the inbox, unread-first then newest-first. */
export async function getAdminSupportThreads(token: string): Promise<SupportThreadRow[]> {
  const data = await supportRequest({ method: 'GET', path: '/api/admin/support/threads', token });
  return parse(supportThreadsSchema, data).threads;
}

/**
 * GET /api/admin/support/threads/[accountId] → that account's support thread,
 * oldest → newest. Server-side this also marks inbound rows readByCoach=true.
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
