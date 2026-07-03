import { coachProfiles } from '@gym/db';
import { eq } from 'drizzle-orm';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The signed-in coach's own public profile card.
 *
 *  - GET   → the caller's coach_profiles row (created lazily if missing so a
 *            freshly-promoted coach always has an editable row).
 *  - PATCH → update displayName / bio / acceptingClients / replyWindowHours on
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

export function OPTIONS() {
  return preflight();
}

/** Reads the caller's row, inserting an empty default row if none exists yet. */
async function loadOrCreateProfile(accountId: string) {
  const db = getDb();
  const existing = await db
    .select({
      accountId: coachProfiles.accountId,
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      avatarUrl: coachProfiles.avatarUrl,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    })
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Lazy-create with schema defaults so the coach always has an editable row.
  const inserted = await db
    .insert(coachProfiles)
    .values({ accountId })
    .onConflictDoNothing()
    .returning({
      accountId: coachProfiles.accountId,
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      avatarUrl: coachProfiles.avatarUrl,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    });

  if (inserted.length > 0) return inserted[0];

  // A concurrent insert won the race — re-read.
  const reread = await db
    .select({
      accountId: coachProfiles.accountId,
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      avatarUrl: coachProfiles.avatarUrl,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    })
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
    .returning({
      accountId: coachProfiles.accountId,
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    });

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
