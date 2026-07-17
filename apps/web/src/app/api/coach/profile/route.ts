import { coachProfiles, type CoachCertification } from '@gym/db';
import { isCoachSpecialty, maskPii } from '@gym/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { isOwnImageDeliveryUrl } from '@/lib/uploads';

export const runtime = 'nodejs';

/**
 * The signed-in coach's own public profile card + portfolio.
 *
 *  - GET   → the caller's coach_profiles row (created lazily if missing so a
 *            freshly-promoted coach always has an editable row).
 *  - PATCH → update the card (displayName / bio / avatarUrl — a Cloudinary
 *            deliveryUrl to set, null/'' to clear /
 *            acceptingClients / replyWindowHours) and the portfolio
 *            (headline / specialties / certifications / achievements /
 *            yearsExperience / capacity) on the caller's OWN row only.
 *            Ownership is intrinsic: the row is keyed on accountId =
 *            principal.id, so a coach can never address anyone else's
 *            profile. Audited.
 *
 * Guarded by requirePermission('coach.user.read') — every coach holds it, and
 * super_admin passes via bypass. There is no cross-account targeting here, so
 * no requireCoachOwnsUser check is needed.
 *
 * PII hygiene (defect C15): every member-visible free-text field
 * (displayName / bio / headline / achievements / certification title+issuer) is
 * run through maskPii on WRITE — mirroring coach workouts/diet plans/milestones.
 * Coaches publishing WhatsApp/Instagram/phone in their public card would let
 * clients route around the in-app relationship and kill the commission model, so
 * the mask is applied server-side at the boundary, not trusted to the client.
 * Fixed-catalog specialties and numeric fields carry no free text — not masked.
 */

const MIN_REPLY_HOURS = 1;
const MAX_REPLY_HOURS = 168; // one week
const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 2000;
const MAX_AVATAR_URL = 500;
/** Upload kinds whose /api/uploads/image `deliveryUrl` may appear here:
 * `coach_avatar` is what the profile editor uploads; `application_avatar` is
 * accepted too because approval copies it into coach_profiles.avatarUrl, so a
 * client echoing the current value back must keep validating. Any other URL —
 * a foreign Cloudinary cloud, or a non-`upload` delivery type such as
 * `image/fetch/<remote-url>` (which would proxy attacker-controlled content
 * to every member) — is rejected by isOwnImageDeliveryUrl. */
const AVATAR_KINDS = ['coach_avatar', 'application_avatar'] as const;

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
  coachTier: coachProfiles.coachTier,
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
  // `photoUrl` mirrors `avatarUrl` — canonical name on all public coach
  // payloads; the legacy key stays for already-shipped mobile parsers.
  return json({ profile: { ...profile, photoUrl: profile.avatarUrl } }, 200);
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
    avatarUrl?: string | null;
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
    // Member-visible → mask any smuggled contact detail (C15). Length is
    // validated against the raw input above; the mask can only shorten runs.
    update.displayName = maskPii(name);
  }

  if ('bio' in body) {
    if (typeof body.bio !== 'string') {
      return json({ error: 'bio_must_be_string' }, 400);
    }
    if (body.bio.length > MAX_BIO) {
      return json({ error: 'bio_too_long' }, 400);
    }
    update.bio = maskPii(body.bio);
  }

  if ('avatarUrl' in body) {
    // null (or an empty string) clears the photo; otherwise it must be a
    // Cloudinary delivery URL minted by our own uploads endpoint, on our own
    // cloud — see AVATAR_KINDS above.
    if (body.avatarUrl === null || body.avatarUrl === '') {
      update.avatarUrl = null;
    } else {
      if (typeof body.avatarUrl !== 'string') {
        return json({ error: 'avatarUrl_must_be_string' }, 400);
      }
      const url = body.avatarUrl.trim();
      if (url.length > MAX_AVATAR_URL || !isOwnImageDeliveryUrl(url, AVATAR_KINDS)) {
        return json({ error: 'avatarUrl_invalid' }, 400);
      }
      update.avatarUrl = url;
    }
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
  // Mask every member-visible free-text portfolio field on write (C15).
  if (portfolio.data.headline !== undefined) update.headline = maskPii(portfolio.data.headline);
  if (portfolio.data.specialties !== undefined) update.specialties = portfolio.data.specialties;
  if (portfolio.data.certifications !== undefined) {
    update.certifications = portfolio.data.certifications.map((c) => ({
      ...c,
      title: maskPii(c.title),
      issuer: maskPii(c.issuer),
    }));
  }
  if (portfolio.data.achievements !== undefined) {
    update.achievements = portfolio.data.achievements.map(maskPii);
  }
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
  const fresh = updated[0];

  const ip = req.headers.get('x-forwarded-for');
  await logAudit(
    principal,
    'coach.profile.update',
    'coach_profile',
    principal.id,
    { fields: Object.keys(update) },
    ip,
  );

  return json({ profile: { ...fresh, photoUrl: fresh.avatarUrl } }, 200);
}
