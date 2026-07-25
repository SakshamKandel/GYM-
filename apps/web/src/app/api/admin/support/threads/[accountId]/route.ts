import { accounts, coachMessages } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';

/**
 * Admin console — one account's 'support' thread (SCALE-UP-PLAN §4.4).
 *
 *  - GET → that account's newest 'support' messages, served oldest→newest.
 *          Read-only — mark-
 *          read is a SEPARATE `POST .../read` (see the sibling `read/route.ts`)
 *          because a GET here is reachable via a plain top-level navigation
 *          (SameSite=Lax still attaches the cookie to a GET) and unread IS the
 *          inbox's work queue; a mutating GET is a silent GET-CSRF that clears
 *          it. Mirrors coach/threads/[userId]'s equivalent split.
 *  - POST {body} → staff reply: 404s if the account doesn't exist (avoids a
 *          raw FK-violation 500) and refuses to fabricate a ticket — a reply
 *          requires at least one PRIOR 'support' message on the thread, so
 *          staff can't push a "reply" notification to a member who never
 *          opened one. Otherwise inserts a 'coach' row with
 *          senderAccountId=principal, stored AS WRITTEN (support is
 *          first-party — an agent quoting a receipt number or a phone number
 *          to call is doing the job; the keep-it-in-the-app rule is aimed at
 *          coach chat, not at us), notifies the member via lib/notify
 *          ('support_reply_member', push data type 'support_reply') with a
 *          masked snippet since that text shows on a lock screen, and audits
 *          'support.reply'.
 *
 * Guarded by requirePermission('support.thread.read' | 'support.thread.reply')
 * — org-wide, no per-account ownership scoping (support tickets are not
 * assigned to a specific coach).
 */

/**
 * Newest N rows returned for the thread. The inbox re-reads this route on every
 * open/poll and replaces its whole message array, so an unbounded SELECT would
 * re-fetch the entire history each time. Mirrors coach/threads/[userId].
 */
const HISTORY_LIMIT = 100;

const postSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'support.thread.read');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;
  const db = getDb();

  const rows = await db
    .select({
      id: coachMessages.id,
      sender: coachMessages.sender,
      senderAccountId: coachMessages.senderAccountId,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
    })
    .from(coachMessages)
    .where(and(eq(coachMessages.accountId, accountId), eq(coachMessages.kind, 'support')))
    .orderBy(desc(coachMessages.createdAt))
    .limit(HISTORY_LIMIT);
  // Fetched newest-first for the cap; flip back to chronological for the client,
  // which renders oldest → newest.
  rows.reverse();

  return json({ messages: rows }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const principal = await requirePermission(req, 'support.thread.reply');
  if (principal instanceof Response) return principal;

  const { accountId } = await params;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  // The account must exist (a bare FK violation on insert would otherwise
  // surface as a raw 500), AND the thread must already have at least one
  // message — a reply with none would fabricate a "support reply" push to a
  // member who never opened a ticket.
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return json({ error: 'not_found' }, 404);

  const [existingMessage] = await db
    .select({ id: coachMessages.id })
    .from(coachMessages)
    .where(and(eq(coachMessages.accountId, accountId), eq(coachMessages.kind, 'support')))
    .limit(1);
  if (!existingMessage) return json({ error: 'no_thread' }, 404);

  // NOT masked. This is first-party support, not coach chat: an agent sending
  // a member the billing address, a receipt reference or a phone number to
  // call IS the job, and hiding it made tickets unanswerable. The
  // keep-it-in-the-app rule exists to stop a coach and a member taking the
  // relationship elsewhere; staff are the other end of that platform.
  // The push snippet below is still masked, because it lands on a lock screen.
  const body = parsed.data.body;

  const inserted = await db
    .insert(coachMessages)
    .values({
      accountId,
      kind: 'support',
      sender: 'coach',
      senderAccountId: principal.id,
      body,
      readByUser: false,
      readByCoach: true,
    })
    .returning({
      id: coachMessages.id,
      sender: coachMessages.sender,
      senderAccountId: coachMessages.senderAccountId,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
    });

  const message = inserted[0];
  if (!message) return json({ error: 'invalid' }, 400);

  // Best-effort notify; never blocks or fails the reply. Goes through
  // lib/notify (NOT raw push): that writes the durable notification-centre row
  // first, honours the member's 'support' category preference and quiet hours,
  // and leaves an unsent row for the retry-unsent cron when FCM blips — a raw
  // push did none of that, so a transient failure silently lost the reply
  // notification. `data.type` stays 'support_reply' so the shipped mobile
  // deep-link switch still lands on /support.
  const snippet = maskPii(body);
  after(() =>
    notify(
      'support_reply_member',
      { accountId },
      {
        title: 'New reply to your support ticket',
        body: snippet.length > 140 ? `${snippet.slice(0, 137)}...` : snippet,
        data: { type: 'support_reply', id: message.id },
      },
    ),
  );

  await logAudit(principal, 'support.reply', 'account', accountId, { len: body.length });

  return json({ message }, 201);
}
