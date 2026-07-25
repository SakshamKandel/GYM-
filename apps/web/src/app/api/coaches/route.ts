import { accounts, admins, coachAssignments, coachProfiles } from '@gym/db';
import { and, eq, sql } from 'drizzle-orm';
import { bearerToken, userForToken } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { json, preflight } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { optimizedImageUrl } from '@/lib/video/cloudinaryProvider';
import { coachRatingFor, loadCoachRatings } from './_lib';

export const runtime = 'nodejs';

/**
 * Member-facing coach discovery hub.
 *
 *  - GET → every ACTIVE coach (admins.role='coach' + coach_profiles.isActive)
 *          with their public portfolio card, coachTier badge, live capacity
 *          signal, and — once enough members have rated them — their real
 *          star average + review count (see ./_lib). Sorted elite > gold >
 *          silver, then by activeClients desc within a tier (SCALE-UP-PLAN
 *          §4.2). Emails are deliberately never selected — coach–member
 *          contact stays inside the app.
 */

const COACH_TIER_RANK: Record<'silver' | 'gold' | 'elite', number> = {
  elite: 3,
  gold: 2,
  silver: 1,
};

/**
 * Widest a directory avatar is ever painted: the 56dp CoachCard portrait, so
 * ~168px on a 3x screen. Coaches upload phone-camera originals, and the whole
 * directory shipped every one of them at full resolution into that circle.
 * `optimizedImageUrl` caps the delivered width and negotiates format/quality on
 * the way out; the stored URL is untouched, and a signed/foreign/already-
 * transformed URL passes through exactly as it is. The full-bleed profile hero
 * lives on GET /api/coaches/[id], which is sized for itself.
 */
const COACH_AVATAR_MAX_WIDTH = 256;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const user = await userForToken(token);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const limited = rateLimit({
    route: 'coaches',
    limit: 30,
    windowMs: 60_000,
    accountId: user.id,
    ip: clientIp(req),
  });
  if (limited) return limited;

  const db = getDb();

  // Correlated count of this coach's ACTIVE assignments (mirrors
  // /api/admin/coaches) so the list stays one round-trip.
  const activeClients = sql<number>`(
    select count(*)::int
    from ${coachAssignments}
    where ${coachAssignments.coachId} = ${accounts.id}
      and ${coachAssignments.status} = 'active'
  )`;

  const rows = await db
    .select({
      id: accounts.id,
      displayName: coachProfiles.displayName,
      headline: coachProfiles.headline,
      avatarUrl: coachProfiles.avatarUrl,
      coachTier: coachProfiles.coachTier,
      specialties: coachProfiles.specialties,
      yearsExperience: coachProfiles.yearsExperience,
      acceptingClients: coachProfiles.acceptingClients,
      capacity: coachProfiles.capacity,
      activeClients,
    })
    .from(admins)
    .innerJoin(accounts, eq(admins.accountId, accounts.id))
    .innerJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    // A suspended coach (accounts.status='suspended') can't log in, so they must
    // not stay publicly listed/requestable — a member's coach_request against
    // them could never be actioned (C3). Suspension writes only accounts.status,
    // leaving admins.role='coach' and coachProfiles.isActive untouched, so this
    // status filter is the guard that removes them from discovery.
    .where(
      and(
        eq(admins.role, 'coach'),
        eq(coachProfiles.isActive, true),
        eq(accounts.status, 'active'),
      ),
    );

  // Real member reviews, folded once for the whole page (additive keys —
  // `rating`/`reviewCount` are null for any coach under the display
  // threshold, so a shipped client that ignores them is unaffected).
  const ratings = await loadCoachRatings(rows.map((r) => r.id));

  // capacity itself stays private on the list — members only see the boolean.
  // `photoUrl` mirrors `avatarUrl` — the canonical name going forward; the
  // legacy key stays so already-shipped mobile parsers keep working.
  const coaches = rows
    .map(({ capacity, ...coach }) => {
      const avatarUrl =
        coach.avatarUrl === null
          ? null
          : optimizedImageUrl(coach.avatarUrl, { maxWidth: COACH_AVATAR_MAX_WIDTH });
      return {
        ...coach,
        displayName: coach.displayName || 'Coach',
        avatarUrl,
        photoUrl: avatarUrl,
        hasCapacity: coach.activeClients < capacity,
        ...coachRatingFor(ratings, coach.id),
      };
    })
    .sort((a, b) => {
      const rankDiff = COACH_TIER_RANK[b.coachTier] - COACH_TIER_RANK[a.coachTier];
      if (rankDiff !== 0) return rankDiff;
      return b.activeClients - a.activeClients;
    });

  return json({ coaches }, 200);
}
