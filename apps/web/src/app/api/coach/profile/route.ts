import { coachProfiles, type CoachCertification } from '@gym/db';
import { isCoachSpecialty } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The signed-in coach's own public profile card + portfolio.
 *
 *  - GET   → the caller's coach_profiles row (created lazily if missing so a
 *            freshly-promoted coach always has an editable row).
 *  - PATCH → update the card (displayName / bio / acceptingClients /
 *            replyWindowHours) and the portfolio (headline / specialties /
 *            certifications / achievements / yearsExperience / capacity) on
 *            the caller's OWN row only. Ownership is intrinsic: the row is keyed
 *            on accountId = principal.id, so a coach can never address anyone
 *            else's profile. Audited.
 *
 * Guarded by requirePermission('coach.user.read') — every coach holds it, and
 * super_admin passes via bypass. There is no cross-account targeting here, so
 * no requireCoachOwnsUser check is needed.
 */

const MIN_REPLY_HOURS = 1;
const MAX_REPLY_HOURS = 168; // one week
const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 2000;

/** Portfolio fields — everything here is member-visible via /api/coaches. */
const portfolioSchema = z.object({
  headline: z.string().trim().max(120).optional(),
  // Fixed catalog (COACH_SPECIALTIES) keeps discovery filters meaningful.
  specialties: z.array(z.string().refine(isCoachSpecialty)).max(6).optional(),
  certifications: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        issuer: z.string().trim().max(80),
        year: z.number().int().min(1950).max(2100).nullable(),
      }),
    )
    .max(10)
    .optional(),
  achievements: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  yearsExperience: z.number().int().min(0).max(60).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
});

/** One column list shared by every select/returning so GET and PATCH agree. */
const PROFILE_COLUMNS = {
  accountId: coachProfiles.accountId,
  displayName: coachProfiles.displayName,
  bio: coachProfiles.bio,
  avatarUrl: coachProfiles.avatarUrl,
  headline: coachProfiles.headline,
  specialties: coachProfiles.specialties,
  certifications: coachProfiles.certifications,
  achievements: coachProfiles.achievements,
  yearsExperience: coachProfiles.yearsExperience,
  capacity: coachProfiles.capacity,
  acceptingClients: coachProfiles.acceptingClients,
  replyWindowHours: coachProfiles.replyWindowHours,
  isActive: coachProfiles.isActive,
} as const;

export function OPTIONS() {
  return preflight();
}

/** Reads the caller's row, inserting an empty default row if none exists yet. */
async function loadOrCreateProfile(accountId: string) {
  const db = getDb();
  const existing = await db
    .select(PROFILE_COLUMNS)
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Lazy-create with schema defaults so the coach always has an editable row.
  const inserted = await db
    .insert(coachProfiles)
    .values({ accountId })
    .onConflictDoNothing()
    .returning(PROFILE_COLUMNS);

  if (inserted.length > 0) return inserted[0];

  // A concurrent insert won the race — re-read.
  const reread = await db
    .select(PROFILE_COLUMNS)
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);
  return reread[0] ?? null;
}

export async function GET(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const profile = await loadOrCreateProfile(principal.id);
  if (!profile) return json({ error: 'not_found' }, 404);
  return json({ profile }, 200);
}

export async function PATCH(req: Request) {
  const principal = await requirePermission(req, 'coach.user.read');
  if (principal instanceof Response) return principal;

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_body' }, 400);
  }

  // Build the update from only the fields present, validating each. Absent
  // fields are left untouched.
  const update: {
    displayName?: string;
    bio?: string;
    acceptingClients?: boolean;
    replyWindowHours?: number;
    headline?: string;
    specialties?: string[];
    certifications?: CoachCertification[];
    achievements?: string[];
    yearsExperience?: number;
    capacity?: number;
  } = {};

  if ('displayName' in body) {
    if (typeof body.displayName !== 'string') {
      return json({ error: 'displayName_must_be_string' }, 400);
    }
    const name = body.displayName.trim();
    if (name.length > MAX_DISPLAY_NAME) {
      return json({ error: 'displayName_too_long' }, 400);
    }
    update.displayName = name;
  }

  if ('bio' in body) {
    if (typeof body.bio !== 'string') {
      return json({ error: 'bio_must_be_string' }, 400);
    }
    if (body.bio.length > MAX_BIO) {
      return json({ error: 'bio_too_long' }, 400);
    }
    update.bio = body.bio;
  }

  if ('acceptingClients' in body) {
    if (typeof body.acceptingClients !== 'boolean') {
      return json({ error: 'acceptingClients_must_be_boolean' }, 400);
    }
    update.acceptingClients = body.acceptingClients;
  }

  if ('replyWindowHours' in body) {
    const n = body.replyWindowHours;
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      return json({ error: 'replyWindowHours_must_be_integer' }, 400);
    }
    if (n < MIN_REPLY_HOURS || n > MAX_REPLY_HOURS) {
      return json({ error: 'replyWindowHours_out_of_range' }, 400);
    }
    update.replyWindowHours = n;
  }

  // Portfolio fields validate as one zod pass (unknown keys are stripped, so
  // the legacy fields above never collide with it).
  const portfolio = portfolioSchema.safeParse(body);
  if (!portfolio.success) return json({ error: 'invalid' }, 400);
  if (portfolio.data.headline !== undefined) update.headline = portfolio.data.headline;
  if (portfolio.data.specialties !== undefined) update.specialties = portfolio.data.specialties;
  if (portfolio.data.certifications !== undefined) {
    update.certifications = portfolio.data.certifications;
  }
  if (portfolio.data.achievements !== undefined) update.achievements = portfolio.data.achievements;
  if (portfolio.data.yearsExperience !== undefined) {
    update.yearsExperience = portfolio.data.yearsExperience;
  }
  if (portfolio.data.capacity !== undefined) update.capacity = portfolio.data.capacity;

  if (Object.keys(update).length === 0) {
    return json({ error: 'no_editable_fields' }, 400);
  }

  const db = getDb();

  // Ensure the row exists first (lazy-create), then update the caller's OWN row.
  await loadOrCreateProfile(principal.id);

  const updated = await db
    .update(coachProfiles)
    .set(update)
    .where(eq(coachProfiles.accountId, principal.id))
    .returning(PROFILE_COLUMNS);

  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'coach.profile.update',
    'coach_profile',
    principal.id,
    { fields: Object.keys(update) },
    ip,
  );

  return json({ profile: updated[0] }, 200);
}
