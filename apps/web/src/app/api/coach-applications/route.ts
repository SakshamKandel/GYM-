import { coachApplications } from '@gym/db';
import { isCoachSpecialty, maskPii } from '@gym/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { bearerToken, userForToken } from '@/lib/auth';
import { adminRoleOf } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Member-initiated coach enrollment (SCALE-UP-PLAN §1.4 / §4.2).
 *
 *  - POST → one open application per account. Free-text fields (headline, bio,
 *           each achievement line) are PII-masked BEFORE storage — contact
 *           details never reach the database. Rejected applications don't
 *           block a re-apply; an already-pending one does (already_open). Any
 *           account that already holds an `admins` row is blocked from
 *           opening a new application — checked first since it's a hard rule
 *           independent of application history: role='coach' gets
 *           already_coach, any OTHER staff role (super_admin/main_admin/
 *           member_admin/etc.) gets already_staff, so the approve route's
 *           anti-demotion guard is never the only thing standing between a
 *           staff member and a role downgrade.
 *  - GET  → the caller's own latest application (any status) — drives the
 *           status screen. `null` when they've never applied.
 */

const MAX_DISPLAY_NAME = 80;
const MAX_HEADLINE = 120;
const MAX_BIO = 2000;

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => v.startsWith('https://'), 'avatarUrl must be an https URL');

const postSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME),
  headline: z.string().trim().max(MAX_HEADLINE),
  bio: z.string().max(MAX_BIO),
  yearsExperience: z.number().int().min(0).max(60),
  specialties: z.array(z.string().refine(isCoachSpecialty)).max(6),
  certifications: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        issuer: z.string().trim().max(80),
        year: z.number().int().min(1950).max(2100).nullable(),
      }),
    )
    .max(10),
  achievements: z.array(z.string().trim().min(1).max(120)).max(10),
  avatarUrl: httpsUrl.optional(),
});

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'coach-applications',
    limit: 3,
    windowMs: 24 * 60 * 60 * 1000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  // Hard rule, independent of application history: any existing staff
  // account is blocked — a coach never re-applies, and non-coach staff
  // (super_admin/main_admin/member_admin/etc.) must never be able to open an
  // application that could later demote them via the approve flow.
  const existingStaffRole = await adminRoleOf(user.id);
  if (existingStaffRole === 'coach') {
    return json({ error: 'already_coach' }, 409);
  }
  if (existingStaffRole !== null) {
    return json({ error: 'already_staff' }, 409);
  }

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const data = parsed.data;

  const db = getDb();

  const pending = await db
    .select({ id: coachApplications.id })
    .from(coachApplications)
    .where(and(eq(coachApplications.accountId, user.id), eq(coachApplications.status, 'pending')))
    .limit(1);
  if (pending.length > 0) return json({ error: 'already_open' }, 409);

  const inserted = await db
    .insert(coachApplications)
    .values({
      accountId: user.id,
      displayName: data.displayName,
      headline: maskPii(data.headline),
      bio: maskPii(data.bio),
      yearsExperience: data.yearsExperience,
      specialties: data.specialties,
      certifications: data.certifications,
      achievements: data.achievements.map((line) => maskPii(line)),
      avatarUrl: data.avatarUrl ?? null,
    })
    .returning({ id: coachApplications.id, status: coachApplications.status });

  const application = inserted[0];
  if (!application) return json({ error: 'invalid' }, 400);

  return json({ id: application.id, status: application.status }, 201);
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const rows = await getDb()
    .select({
      id: coachApplications.id,
      status: coachApplications.status,
      reviewNote: coachApplications.reviewNote,
      createdAt: coachApplications.createdAt,
      decidedAt: coachApplications.decidedAt,
      displayName: coachApplications.displayName,
      headline: coachApplications.headline,
      bio: coachApplications.bio,
      yearsExperience: coachApplications.yearsExperience,
      specialties: coachApplications.specialties,
      certifications: coachApplications.certifications,
      achievements: coachApplications.achievements,
      avatarUrl: coachApplications.avatarUrl,
    })
    .from(coachApplications)
    .where(eq(coachApplications.accountId, user.id))
    .orderBy(desc(coachApplications.createdAt))
    .limit(1);

  return json({ application: rows[0] ?? null }, 200);
}
