import { coachClientNotes } from '@gym/db';
import { maskPii } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requireCoachOwnsUser, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the coach's PRIVATE CRM note about a client (Pack K). One live
 * note per (coach, client), never shown to the member. Even though it is private
 * it is maskPii'd on write, matching every other coach-authored text path (a
 * coach must not stash a member's phone number here either).
 *
 *  - GET → this coach's note for the client (or empty string).
 *  - PUT {note} → upsert (create or replace) the note.
 *
 * Guards (fail closed): requirePermission('coach.user.read' GET / 'coach.message.user'
 * PUT) + requireCoachOwnsUser(userId). The note is scoped to `coachId = me`, so
 * two coaches (e.g. after a reassignment) never see each other's notes.
 */

const putSchema = z.object({ note: z.string().max(4000) });

export function OPTIONS() {
  return preflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const [row] = await getDb()
    .select({ note: coachClientNotes.note, updatedAt: coachClientNotes.updatedAt })
    .from(coachClientNotes)
    .where(
      and(eq(coachClientNotes.coachId, principal.id), eq(coachClientNotes.userId, userId)),
    )
    .limit(1);

  return json({ note: row?.note ?? '', updatedAt: row?.updatedAt ?? null }, 200);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const { userId } = await params;
  if (!(await requireCoachOwnsUser(principal, userId))) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const note = maskPii(parsed.data.note.trim());

  const now = new Date();
  const [row] = await getDb()
    .insert(coachClientNotes)
    .values({ coachId: principal.id, userId, note, updatedAt: now })
    .onConflictDoUpdate({
      target: [coachClientNotes.coachId, coachClientNotes.userId],
      set: { note, updatedAt: now },
    })
    .returning({ note: coachClientNotes.note, updatedAt: coachClientNotes.updatedAt });

  await logAudit(principal, 'coach.note.save', 'account', userId, { len: note.length });

  return json({ note: row?.note ?? note, updatedAt: row?.updatedAt ?? now }, 200);
}
