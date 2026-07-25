import { coachProfiles } from '@gym/db';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { ProfileForm, type CoachProfile } from './ProfileForm';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Your profile' };
export const dynamic = 'force-dynamic';

/**
 * Coach profile editor. Server component: resolves the signed-in coach from the
 * 'gt_staff' cookie (the layout guards, but we re-resolve here to fail safe and
 * get the id), reads their OWN coach_profiles row (lazy-creating defaults if the
 * row is missing so a freshly-promoted coach always has something to edit), and
 * hands it to the client form which PATCHes /api/coach/profile.
 *
 * The column list covers the whole member-visible card: the basics plus the
 * portfolio (photo, headline, specialties, certifications, achievements, years,
 * capacity) and the seniority tier — everything PATCH /api/coach/profile already
 * accepted but the web editor used to leave stranded on mobile.
 */

/** One column list so every read of the row returns the same shape. */
const PROFILE_COLUMNS = {
  displayName: coachProfiles.displayName,
  bio: coachProfiles.bio,
  acceptingClients: coachProfiles.acceptingClients,
  replyWindowHours: coachProfiles.replyWindowHours,
  isActive: coachProfiles.isActive,
  avatarUrl: coachProfiles.avatarUrl,
  coachTier: coachProfiles.coachTier,
  headline: coachProfiles.headline,
  specialties: coachProfiles.specialties,
  certifications: coachProfiles.certifications,
  achievements: coachProfiles.achievements,
  yearsExperience: coachProfiles.yearsExperience,
  capacity: coachProfiles.capacity,
} as const;

/** Schema defaults, used only if both the insert and the re-read lose a race. */
const FALLBACK_PROFILE: CoachProfile = {
  displayName: '',
  bio: '',
  acceptingClients: true,
  replyWindowHours: 24,
  isActive: true,
  avatarUrl: null,
  coachTier: 'silver',
  headline: '',
  specialties: [],
  certifications: [],
  achievements: [],
  yearsExperience: 0,
  capacity: 50,
};

async function loadProfile(accountId: string): Promise<CoachProfile> {
  const db = getDb();
  const rows = await db
    .select(PROFILE_COLUMNS)
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  if (rows.length > 0) return rows[0];

  // No row yet — insert defaults so the page always renders an editable form.
  const inserted = await db
    .insert(coachProfiles)
    .values({ accountId })
    .onConflictDoNothing()
    .returning(PROFILE_COLUMNS);

  if (inserted.length > 0) return inserted[0];

  // Concurrent insert won — re-read.
  const reread = await db
    .select(PROFILE_COLUMNS)
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  return reread[0] ?? FALLBACK_PROFILE;
}

export default async function CoachProfilePage() {
  const { principal: coach } = await requireCoachPage('coach.user.read');

  const profile = await loadProfile(coach.id);

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader
        title="Your profile"
        subtitle="This is how you appear to members browsing for a coach. Keep it current and set whether you're taking on new clients."
      />
      <ProfileForm initial={profile} email={coach.email} />
    </div>
  );
}
