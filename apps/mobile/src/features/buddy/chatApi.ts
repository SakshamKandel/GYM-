import { z } from 'zod';
import { BASE_URL } from '../../lib/api/client';

/**
 * Friend-to-friend DM client (SCALE-UP-PLAN §4.4 / §5.1) — the buddy chat
 * list, one thread's messages, sending, and the shared unread-badge
 * endpoint. Same philosophy as the rest of this app's API clients: zod at
 * the boundary, typed error codes, network failures never throw where the
 * caller can degrade quietly (getUnread), and resilient list parsing so one
 * bad row can't blank out a whole screen.
 */

export type ChatErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'network';

export class ChatApiError extends Error {
  readonly code: ChatErrorCode;

  constructor(code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatApiError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to ChatApiError (anything else = network). */
export function toChatError(err: unknown): ChatApiError {
  return err instanceof ChatApiError ? err : new ChatApiError('network');
}

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const errorBodySchema = z.object({ error: z.string() });

function serverErrorCode(raw: string): ChatErrorCode | null {
  return raw === 'not_found' || raw === 'invalid' ? raw : null;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  token: string;
  body?: Record<string, unknown>;
}

async function chatRequest(opts: RequestOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : null),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ChatApiError('network', "Can't reach the server");
  }

  if (res.ok) {
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new ChatApiError('network', 'Unexpected server response');
    }
  }

  let code: ChatErrorCode =
    res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'network';
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) code = serverErrorCode(parsed.data.error) ?? code;
  } catch {
    // Body wasn't JSON — keep the status-derived code.
  }
  throw new ChatApiError(code);
}

function parseChat<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ChatApiError('network', 'Unexpected server response');
  return parsed.data;
}

// ── Thread list (GET /api/buddy/threads) ───────────────────────

const buddyThreadSchema = z.object({
  linkId: z.string(),
  buddy: z.object({ accountId: z.string(), displayName: z.string() }),
  lastBody: z.string().nullable(),
  lastAt: z.string().nullable(),
  unread: z.number(),
});
export type BuddyThreadSummary = z.infer<typeof buddyThreadSchema>;

/** Resilient list: an unparseable row is dropped rather than failing the fetch. */
const buddyThreadsSchema = z.object({
  threads: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): BuddyThreadSummary[] => {
      const parsed = buddyThreadSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/buddy/threads → one row per accepted buddy with a chat preview. */
export async function getBuddyThreads(token: string): Promise<BuddyThreadSummary[]> {
  const data = await chatRequest({ method: 'GET', path: '/api/buddy/threads', token });
  return parseChat(buddyThreadsSchema, data).threads;
}

// ── One thread (GET/POST /api/buddy/threads/[linkId]) ──────────

const buddyChatMessageSchema = z.object({
  id: z.string(),
  senderAccountId: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type BuddyChatMessage = z.infer<typeof buddyChatMessageSchema>;

const buddyMessagesSchema = z.object({
  messages: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw): BuddyChatMessage[] => {
      const parsed = buddyChatMessageSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/**
 * GET /api/buddy/threads/[linkId] → that thread's messages, oldest→newest.
 * `after` is an optional ISO cursor. 'forbidden' when the caller isn't a
 * member of an ACCEPTED link with this id.
 */
export async function getBuddyThread(
  token: string,
  linkId: string,
  after?: string,
): Promise<BuddyChatMessage[]> {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  const data = await chatRequest({
    method: 'GET',
    path: `/api/buddy/threads/${encodeURIComponent(linkId)}${query}`,
    token,
  });
  return parseChat(buddyMessagesSchema, data).messages;
}

const sendBuddyMessageSchema = z.object({ message: buddyChatMessageSchema });

/** POST /api/buddy/threads/[linkId] {body} → the inserted message. */
export async function sendBuddyMessage(
  token: string,
  linkId: string,
  body: string,
): Promise<BuddyChatMessage> {
  const data = await chatRequest({
    method: 'POST',
    path: `/api/buddy/threads/${encodeURIComponent(linkId)}`,
    token,
    body: { body },
  });
  return parseChat(sendBuddyMessageSchema, data).message;
}

// ── Unread summary (GET /api/me/unread) ────────────────────────

const unreadBuddyRowSchema = z.object({ linkId: z.string(), count: z.number() });

const unreadSchema = z.object({
  support: z.number(),
  coachChat: z.number(),
  buddy: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((raw) => {
      const parsed = unreadBuddyRowSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});
export type UnreadSummary = z.infer<typeof unreadSchema>;

/**
 * GET /api/me/unread → support + coach_chat unread counts, plus a sparse
 * per-link buddy-DM unread list (only links with unread rows are included).
 * NEVER throws — any failure resolves to all-zero so a badge fetch can never
 * break the screen it decorates.
 */
export async function getUnread(token: string): Promise<UnreadSummary> {
  try {
    const data = await chatRequest({ method: 'GET', path: '/api/me/unread', token });
    return parseChat(unreadSchema, data);
  } catch {
    return { support: 0, coachChat: 0, buddy: [] };
  }
}
