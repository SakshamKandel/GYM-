import { coachProfiles } from '@gym/db';
import { eq } from 'drizzle-orm';
import { PageHeader } from '@/components/console';
import { requireCoachPage } from '@/lib/coachPage';
import { getDb } from '@/lib/db';
import { ProfileForm, type CoachProfile } from './ProfileForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach profile editor. Server component: resolves the signed-in coach from the
 * 'gt_staff' cookie (the layout guards, but we re-resolve here to fail safe and
 * get the id), reads their OWN coach_profiles row (lazy-creating defaults if the
 * row is missing so a freshly-promoted coach always has something to edit), and
 * hands it to the client form which PATCHes /api/coach/profile.
 */
async function loadProfile(accountId: string): Promise<CoachProfile> {
  const db = getDb();
  const rows = await db
    .select({
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    })
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  if (rows.length > 0) return rows[0];

  // No row yet — insert defaults so the page always renders an editable form.
  const inserted = await db
    .insert(coachProfiles)
    .values({ accountId })
    .onConflictDoNothing()
    .returning({
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    });

  if (inserted.length > 0) return inserted[0];

  // Concurrent insert won — re-read.
  const reread = await db
    .select({
      displayName: coachProfiles.displayName,
      bio: coachProfiles.bio,
      acceptingClients: coachProfiles.acceptingClients,
      replyWindowHours: coachProfiles.replyWindowHours,
      isActive: coachProfiles.isActive,
    })
    .from(coachProfiles)
    .where(eq(coachProfiles.accountId, accountId))
    .limit(1);

  return (
    reread[0] ?? {
      displayName: '',
      bio: '',
      acceptingClients: true,
      replyWindowHours: 24,
      isActive: true,
    }
  );
}

export default async function CoachProfilePage() {
  const { principal: coach } = await requireCoachPage('coach.user.read');

  const profile = await loadProfile(coach.id);

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader
        title="Your profile"
        subtitle="This is how you appear to clients. Keep your bio current and set whether you're taking on new clients."
      />
      <ProfileForm initial={profile} email={coach.email} />
    </div>
  );
}
