import { accounts, coachMessages } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, asc, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Admin console — one account's 'support' thread (SCALE-UP-PLAN §4.4).
 *
 *  - GET → that account's 'support' messages oldest→newest. Read-only — mark-
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
 *          senderAccountId=principal, PII-masked (keeps parity with the human
 *          coach_chat reply path even though the author is support staff —
 *          contact details never reach storage from either side), pushes
 *          'support_reply', audits 'support.reply'.
 *
 * Guarded by requirePermission('support.thread.read' | 'support.thread.reply')
 * — org-wide, no per-account ownership scoping (support tickets are not
 * assigned to a specific coach).
 */

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
    .orderBy(asc(coachMessages.createdAt));

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

  // Masked BEFORE storage — the in-app-contact policy binds support staff too.
  const body = maskPii(parsed.data.body);

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

  // Best-effort notify; never blocks or fails the reply.
  after(() =>
    sendPushToAccount(accountId, {
      title: 'New reply to your support ticket',
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      data: { type: 'support_reply', messageId: message.id },
    }),
  );

  await logAudit(principal, 'support.reply', 'account', accountId, { len: body.length });

  return json({ message }, 201);
}
