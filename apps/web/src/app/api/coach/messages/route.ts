import { coachAssignments, coachMessages, supportThreadStates } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { humanMessageDelivery } from '@/lib/humanMessaging';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Human messaging — one endpoint serving two async threads per account,
 * split by `kind` ('coach_chat' | 'support').
 *
 *  - GET  ?kind=…  → the signed-in account's newest messages for that thread
 *                    (capped, served oldest → newest). Any authenticated tier can READ (so a
 *                    a member still sees their history). Marks
 *                    coach-authored rows readByUser=true after serving. For
 *                    kind='support' the payload also carries the ticket's
 *                    lifecycle `status` (additive optional field) so the app
 *                    can tell the member their ticket was closed.
 *  - POST {kind, body} → 'coach_chat' requires an active persisted human
 *                    coach assignment. 'support' is open to any signed-in
 *                    user and routes to the staff support inbox, and REOPENS a
 *                    resolved ticket (see the upsert below). The response
 *                    contains only rows that were actually persisted, plus an
 *                    additive `contactHidden` flag when the stored body
 *                    differs from what was sent.
 *
 * Contact masking is gated on `kind`: coach chat only. See the POST body.
 *
 * No real-time: the mobile app loads on focus and appends optimistically.
 */

const kindSchema = z.enum(['coach_chat', 'support']);

/**
 * Newest N rows returned for a thread. The mobile chat reloads on focus and
 * replaces its whole message array, so an unbounded SELECT would re-fetch the
 * entire history every time and hold it all in client state. Matches the coach
 * console's HISTORY_LIMIT (coach/threads/[userId]).
 */
const HISTORY_LIMIT = 100;

const postSchema = z.object({
  kind: kindSchema,
  body: z.string().trim().min(1).max(2000),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const parsedKind = kindSchema.safeParse(url.searchParams.get('kind'));
  if (!parsedKind.success) return json({ error: 'invalid' }, 400);
  const kind = parsedKind.data;

  const db = getDb();
  const rows = await db
    .select({
      id: coachMessages.id,
      kind: coachMessages.kind,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
      readByUser: coachMessages.readByUser,
    })
    .from(coachMessages)
    .where(and(eq(coachMessages.accountId, user.id), eq(coachMessages.kind, kind)))
    .orderBy(desc(coachMessages.createdAt))
    .limit(HISTORY_LIMIT);
  // Fetched newest-first for the cap; flip back to chronological for the client,
  // which renders oldest → newest.
  rows.reverse();

  // Clear this thread's unread badge (/api/me/unread) now that it's been
  // served — mirrors the coach-console mark-read-on-open convention, on the
  // member side: only coach-authored rows count toward the badge.
  await db
    .update(coachMessages)
    .set({ readByUser: true })
    .where(
      and(
        eq(coachMessages.accountId, user.id),
        eq(coachMessages.kind, kind),
        eq(coachMessages.sender, 'coach'),
        eq(coachMessages.readByUser, false),
      ),
    );

  // Support tickets have a staff-facing lifecycle (support_thread_states, one
  // row per account, created lazily — no row means an implicitly-'open'
  // thread). Members never saw it, so a ticket staff had CLOSED looked exactly
  // like a live one. Returned as an additive optional field: coach_chat has no
  // lifecycle, so the key is simply absent there and every shipped client that
  // only reads `messages` is unaffected. Keyed single-row lookup rather than a
  // join onto every message row — same result, one index hit on the PK.
  if (kind === 'support') {
    const [state] = await db
      .select({ status: supportThreadStates.status })
      .from(supportThreadStates)
      .where(eq(supportThreadStates.accountId, user.id))
      .limit(1);
    return json({ messages: rows, status: state?.status ?? 'open' }, 200);
  }

  return json({ messages: rows }, 200);
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { kind } = parsed.data;

  // 'support' is open to any signed-in user — a
  // tighter 5/min budget keeps that wide-open door from being spammed.
  // 'coach_chat' has a slightly wider budget for a live coaching exchange.
  const limited =
    kind === 'support'
      ? rateLimit({
          route: 'coach/messages/support',
          limit: 5,
          windowMs: 60_000,
          accountId: user.id,
          ip: clientIp(req),
        })
      : rateLimit({
          route: 'coach/messages',
          limit: 10,
          windowMs: 60_000,
          accountId: user.id,
          ip: clientIp(req),
        });
  if (limited) return limited;

  const db = getDb();

  // Resolve the real human who owns coach_chat. Support has its own staff
  // inbox, so it does not need an assignment lookup.
  let coachId: string | null = null;
  if (kind === 'coach_chat') {
    const assigned = await db
      .select({ id: coachAssignments.id, coachId: coachAssignments.coachId })
      .from(coachAssignments)
      .where(and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')))
      .limit(1);
    coachId = assigned[0]?.coachId ?? null;
  }

  // Fail before persistence when no human owns this coach thread. This keeps a
  // successful send synonymous with a real inbox receiving a stored message.
  const delivery = humanMessageDelivery(kind, coachId);
  if (!delivery.ok) return json({ error: delivery.error }, 503);

  // Masked BEFORE storage, but ONLY on the coach thread. Coach chat is where
  // the platform loses its fee if a pair swaps numbers and leaves. Support is
  // first-party: a member telling our own staff their phone number or the
  // address on their account is the whole point of writing in, and hiding it
  // just makes the ticket unanswerable. The staff notification below is still
  // masked either way, because that text lands on a lock screen.
  const raw = parsed.data.body;
  const body = kind === 'coach_chat' ? maskPii(raw) : raw;
  const contactHidden = body !== raw;

  // Insert the member message only after a real delivery target is known.
  const insertedUser = await db
    .insert(coachMessages)
    .values({ accountId: user.id, kind, sender: 'user', body, readByUser: true })
    .returning({
      id: coachMessages.id,
      kind: coachMessages.kind,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
      readByUser: coachMessages.readByUser,
    });

  const userMsg = insertedUser[0];
  if (!userMsg) return json({ error: 'invalid' }, 400);

  // A member writing into a RESOLVED ticket has to put it back on the staff
  // queue. Both support inboxes default to their Open tab, which filters on
  // support_thread_states.status, so without this the reply is stored and
  // notified but never visible where staff actually work — the ticket goes
  // silent. Same upsert shape as the staff reopen route
  // (/api/admin/support/threads/[accountId]/reopen): status back to 'open',
  // resolvedBy/resolvedAt cleared, updatedAt bumped, assignment left alone so
  // the agent who owned it keeps it. The row is created lazily, so a thread
  // that was never explicitly resolved is a harmless no-op write.
  //
  // Best-effort: the member's message is already durable and notified, so a
  // failure here must not turn a delivered message into a send error — it is
  // logged, and both inboxes also treat "has unread member messages" as open,
  // which covers a state row that lags behind.
  if (kind === 'support') {
    const reopenedAt = new Date();
    try {
      await db
        .insert(supportThreadStates)
        .values({
          accountId: user.id,
          status: 'open',
          resolvedBy: null,
          resolvedAt: null,
          updatedAt: reopenedAt,
        })
        .onConflictDoUpdate({
          target: supportThreadStates.accountId,
          set: { status: 'open', resolvedBy: null, resolvedAt: null, updatedAt: reopenedAt },
        });
    } catch (err) {
      console.error(`[support] reopen-on-member-reply failed account=${user.id}`, err);
    }
  }

  // Inbound-work notifications (WP-2 / Pack B/K) — fire-and-forget, never block
  // or fail the send. §7.2-S2: the member's message + name are member-authored,
  // so they are masked and attributed before reaching a privileged (staff /
  // coach) recipient — a member must not be able to forge a platform-authored
  // push through the free-text field. Support bodies are stored as written, so
  // the snippet is masked here rather than relying on the stored text.
  const masked = kind === 'coach_chat' ? body : maskPii(body);
  const snippet = masked.length > 120 ? `${masked.slice(0, 117)}...` : masked;
  const who = maskPii(user.displayName).trim() || 'A member';
  if (delivery.target === 'support_inbox') {
    // Every support ticket lands in the admin support inbox — notify staff who
    // can read it (mirrors the coach-application fan-out).
    after(() =>
      notify(
        'support_message_staff',
        { role: 'staff', permission: 'support.thread.read' },
        {
          title: 'New support message',
          body: `${who}: ${snippet}`,
          data: { type: 'support', id: user.id },
        },
      ),
    );
  } else {
    // The assigned human coach answers via the console — tell them a client
    // wrote in (their inbox otherwise only refreshes on focus).
    after(() =>
      notify(
        'coach_message_client',
        { accountId: delivery.accountId },
        {
          title: 'New message from your client',
          body: `${who}: ${snippet}`,
          data: { type: 'coach_chat', id: user.id },
        },
      ),
    );
  }

  // The assigned coach or support agent replies asynchronously through their
  // persisted console. Success means this member row was stored and routed;
  // no fabricated reply is inserted.
  //
  // `contactHidden` is additive: true when what we stored differs from what was
  // sent, so the app can tell the sender their message was changed instead of
  // letting them believe a phone number went through. Older clients ignore it.
  return json({ messages: [userMsg], contactHidden }, 201);
}
