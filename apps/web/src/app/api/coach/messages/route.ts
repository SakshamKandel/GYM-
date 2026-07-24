import { coachAssignments, coachMessages } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, asc, eq } from 'drizzle-orm';
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
 *  - GET  ?kind=…  → the signed-in account's messages for that thread,
 *                    oldest → newest. Any authenticated tier can READ (so a
 *                    a member still sees their history). Marks
 *                    coach-authored rows readByUser=true after serving.
 *  - POST {kind, body} → 'coach_chat' requires an active persisted human
 *                    coach assignment. 'support' is open to any signed-in
 *                    user and routes to the staff support inbox. The response
 *                    contains only rows that were actually persisted.
 *
 * No real-time: the mobile app loads on focus and appends optimistically.
 */

const kindSchema = z.enum(['coach_chat', 'support']);

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
    .orderBy(asc(coachMessages.createdAt));

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

  // Masked BEFORE storage — contact details never reach the database.
  const body = maskPii(parsed.data.body);

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

  // Inbound-work notifications (WP-2 / Pack B/K) — fire-and-forget, never block
  // or fail the send. §7.2-S2: the member's message + name are member-authored,
  // so they are maskPii'd (`body` already is) and attributed before reaching a
  // privileged (staff / coach) recipient — a member must not be able to forge a
  // platform-authored push through the free-text field.
  const snippet = body.length > 120 ? `${body.slice(0, 117)}...` : body;
  const who = maskPii(user.displayName).trim() || 'A member';
  if (delivery.target === 'support_inbox') {
    // Every support ticket lands in the admin support inbox — notify staff who
    // can read it (mirrors the coach-application fan-out).
    void notify(
      'support_message_staff',
      { role: 'staff', permission: 'support.thread.read' },
      {
        title: 'New support message',
        body: `${who}: ${snippet}`,
        data: { type: 'support', id: user.id },
      },
    );
  } else {
    // The assigned human coach answers via the console — tell them a client
    // wrote in (their inbox otherwise only refreshes on focus).
    void notify(
      'coach_message_client',
      { accountId: delivery.accountId },
      {
        title: 'New message from your client',
        body: `${who}: ${snippet}`,
        data: { type: 'coach_chat', id: user.id },
      },
    );
  }

  // The assigned coach or support agent replies asynchronously through their
  // persisted console. Success means this member row was stored and routed;
  // no fabricated reply is inserted.
  return json({ messages: [userMsg] }, 201);
}
