import { coachMessages } from '@gym/db';
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
 *  - GET → that account's 'support' messages oldest→newest, then marks the
 *          inbound (sender='user') rows readByCoach=true — clears the inbox's
 *          unread badge on open. Mirrors coach/threads/[userId]'s mark-read
 *          flow, scoped to kind='support' instead of 'coach_chat'.
 *  - POST {body} → staff reply: inserts a 'coach' row with
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

  await db
    .update(coachMessages)
    .set({ readByCoach: true })
    .where(
      and(
        eq(coachMessages.accountId, accountId),
        eq(coachMessages.kind, 'support'),
        eq(coachMessages.sender, 'user'),
        eq(coachMessages.readByCoach, false),
      ),
    );

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
  // Masked BEFORE storage — the in-app-contact policy binds support staff too.
  const body = maskPii(parsed.data.body);

  const db = getDb();

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
