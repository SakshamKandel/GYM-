import { coachMessages } from '@gym/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { greeceCoachReply } from '@/lib/groqCoach';
import { json, preflight, readJson } from '@/lib/http';

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
  /**
   * Optional client-generated coach reply (AI Greece runs on-device with the
   * app's bundled Groq key). When present it's stored verbatim as the coach
   * message; when absent we fall back to the server Groq reply / auto-ack.
   */
  coachReply: z.string().trim().min(1).max(4000).optional(),
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

  // Sending is the Elite promise made real — gate it server-side (client
  // checks are UI-only, PROJECT_PLAN §8).
  if (user.tier !== 'elite') return json({ error: 'forbidden' }, 403);

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { kind, body, coachReply } = parsed.data;

  const db = getDb();

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

  // The coach reply is AI-generated in Greece's voice. Preferred path: the
  // app generates it on-device with its bundled Groq key and sends it as
  // `coachReply`, so this works with no server key set. If the client didn't
  // provide one (offline / generation failed), fall back to the server Groq
  // reply, and finally to the canned acknowledgement — so the thread is never
  // left hanging.
  let replyBody: string;
  if (coachReply) {
    replyBody = coachReply;
  } else {
    const history = await db
      .select({ sender: coachMessages.sender, body: coachMessages.body })
      .from(coachMessages)
      .where(and(eq(coachMessages.accountId, user.id), eq(coachMessages.kind, kind)))
      .orderBy(asc(coachMessages.createdAt));
    const aiReply = await greeceCoachReply(kind, user.displayName, history);
    replyBody = aiReply ?? autoAckBody(kind, user.displayName);
  }

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

  const userMsg = insertedUser[0];
  const coachMsg = insertedCoach[0];
  if (!userMsg || !coachMsg) return json({ error: 'invalid' }, 400);

  return json({ messages: [userMsg, coachMsg] }, 201);
}
