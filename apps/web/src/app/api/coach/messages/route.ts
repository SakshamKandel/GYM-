import { coachAssignments, coachMessages } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { greeceCoachReply } from '@/lib/groqCoach';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Elite coach messaging — one endpoint serving two async threads per account,
 * split by `kind` ('coach_chat' | 'support').
 *
 *  - GET  ?kind=…  → the signed-in account's messages for that thread,
 *                    oldest → newest. Any authenticated tier can READ (so a
 *                    lapsed Elite user still sees their history).
 *  - POST {kind, body} → ELITE ONLY. Inserts the user's message, then an
 *                    auto-acknowledgement 'coach' row that references the
 *                    user's display name and sets reply expectations. Returns
 *                    both inserted messages.
 *
 * No real-time: the mobile app loads on focus and appends optimistically.
 */

const kindSchema = z.enum(['coach_chat', 'support']);

const postSchema = z.object({
  kind: kindSchema,
  body: z.string().trim().min(1).max(2000),
});

/** The auto-ack sets expectations so an async thread still feels answered. */
function autoAckBody(kind: z.infer<typeof kindSchema>, name: string): string {
  const who = name.trim() || 'there';
  return kind === 'coach_chat'
    ? `Got your message, ${who} — Greece reviews these personally and replies within 24h. Keep training.`
    : `Thanks ${who}, your Elite priority ticket is in — we will get back within a few hours.`;
}

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

  return json({ messages: rows }, 200);
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Each send can trigger a Groq completion — 10/min/account caps the spend.
  const limited = rateLimit({
    route: 'coach/messages',
    limit: 10,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const db = getDb();

  // One lookup serves the send gate AND the AI-suppression below: an active
  // human-coach assignment (any coach) lets the member chat regardless of tier.
  const assigned = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(and(eq(coachAssignments.userId, user.id), eq(coachAssignments.status, 'active')))
    .limit(1);
  const hasCoach = assigned.length > 0;

  // Sending is the Elite promise made real — gate it server-side (client
  // checks are UI-only, PROJECT_PLAN §8). Assigned members also pass: their
  // coach relationship, not their tier, is what earns the thread.
  if (user.tier !== 'elite' && !hasCoach) return json({ error: 'forbidden' }, 403);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { kind } = parsed.data;
  // Masked BEFORE storage — contact details never reach the database.
  const body = maskPii(parsed.data.body);

  // Insert the user's message, then the auto-ack, so createdAt orders them
  // correctly (defaultNow() on the second row is strictly later).
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

  // Human-coach handoff — coach_chat thread ONLY: if this account has an ACTIVE
  // coach assignment, a real coach owns the reply, so skip the AI auto-reply and
  // return just the user's message. The coach answers later via the console
  // (sender='coach', which the mobile app already renders on the left as a
  // "Greece" message). The 'support' thread is a separate channel handled by
  // support staff, so it KEEPS its auto-ack regardless of coach assignment.
  // With no assignment, today's AI behavior is preserved exactly below.
  if (kind === 'coach_chat' && hasCoach) {
    return json({ messages: [userMsg] }, 201);
  }

  // The coach reply is AI-generated in Greece's voice, SERVER-SIDE (the key
  // never ships in the app). Load the thread so the model can answer in
  // context, then fall back to the canned acknowledgement if Groq is
  // unavailable — so the thread is never left hanging.
  const history = await db
    .select({ sender: coachMessages.sender, body: coachMessages.body })
    .from(coachMessages)
    .where(and(eq(coachMessages.accountId, user.id), eq(coachMessages.kind, kind)))
    .orderBy(asc(coachMessages.createdAt));
  const aiReply = await greeceCoachReply(kind, user.displayName, history);
  const replyBody = aiReply ?? autoAckBody(kind, user.displayName);

  const insertedCoach = await db
    .insert(coachMessages)
    .values({
      accountId: user.id,
      kind,
      sender: 'coach',
      body: replyBody,
      readByUser: false,
    })
    .returning({
      id: coachMessages.id,
      kind: coachMessages.kind,
      sender: coachMessages.sender,
      body: coachMessages.body,
      createdAt: coachMessages.createdAt,
      readByUser: coachMessages.readByUser,
    });

  const coachMsg = insertedCoach[0];
  if (!coachMsg) return json({ error: 'invalid' }, 400);

  return json({ messages: [userMsg, coachMsg] }, 201);
}
