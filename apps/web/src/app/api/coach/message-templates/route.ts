import { coachMessageTemplates } from '@gym/db';
import { maskPii } from '@gym/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Coach console — the signed-in coach's saved quick-reply templates (Pack K).
 * Self-scoped: every row is keyed to `coachId = me`; a coach only ever sees or
 * mutates their own. Template bodies are maskPii'd on write — they get pasted
 * into a client-facing reply, so the same in-app-contact policy binds them.
 *
 *  - GET  → my templates, newest first.
 *  - POST {title?, body} → create one (bounded per coach).
 *
 * Guarded by requirePermission('coach.message.user') — the same capability the
 * reply/assign writes use; a coach who can message clients can manage their
 * canned replies.
 */

const MAX_TEMPLATES = 40;

const postSchema = z.object({
  title: z.string().trim().max(60).optional(),
  body: z.string().trim().min(1).max(2000),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const templates = await getDb()
    .select({
      id: coachMessageTemplates.id,
      title: coachMessageTemplates.title,
      body: coachMessageTemplates.body,
      createdAt: coachMessageTemplates.createdAt,
    })
    .from(coachMessageTemplates)
    .where(eq(coachMessageTemplates.coachId, principal.id))
    .orderBy(desc(coachMessageTemplates.createdAt));

  return json({ templates }, 200);
}

export async function POST(req: Request) {
  const principal = await requirePermission(req, 'coach.message.user');
  if (principal instanceof Response) return principal;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();

  // Bound the per-coach template count — a canned-reply library is small.
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(coachMessageTemplates)
    .where(eq(coachMessageTemplates.coachId, principal.id));
  if ((countRow?.n ?? 0) >= MAX_TEMPLATES) {
    return json({ error: 'too_many' }, 409);
  }

  const [row] = await db
    .insert(coachMessageTemplates)
    .values({
      coachId: principal.id,
      title: maskPii(parsed.data.title ?? ''),
      body: maskPii(parsed.data.body),
    })
    .returning({
      id: coachMessageTemplates.id,
      title: coachMessageTemplates.title,
      body: coachMessageTemplates.body,
      createdAt: coachMessageTemplates.createdAt,
    });

  if (!row) return json({ error: 'invalid' }, 400);
  await logAudit(principal, 'coach.template.create', 'coach_message_template', row.id, {});

  return json({ template: row }, 201);
}
