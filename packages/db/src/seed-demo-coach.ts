import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { createDb } from './index';
import {
  accounts,
  admins,
  coachAssignments,
  coachMilestones,
  coachProfiles,
} from './schema';

/**
 * Seed ONE demo verified coach ("Alex Grivas") + a demo client so the coach
 * discovery hub and public coach profile have a complete, realistic profile
 * to render: gold seniority tier, 5 specialties, 3 certifications,
 * achievements, an active client assignment and 3 coach-logged milestones.
 *
 * Idempotent: keyed by email — re-running updates the profile in place and
 * never duplicates rows.
 *
 * Run from packages/db (DATABASE_URL comes from the repo-root .env, same as
 * drizzle.config.ts):  pnpm --filter @gym/db seed:demo-coach
 */

config({ path: '../../.env' });

const COACH_EMAIL = 'demo.coach@gymapp.local';
const CLIENT_EMAIL = 'demo.client@gymapp.local';

const COACH_NAME = 'Alex Grivas';

/** All values MUST come from COACH_SPECIALTIES in @gym/shared. */
const SPECIALTIES = ['hypertrophy', 'contest prep', 'strength', 'nutrition', 'fat loss'];

/** Shape must match CoachCertification exactly: {title, issuer, year|null}. */
const CERTIFICATIONS = [
  { title: 'Certified Strength & Conditioning Specialist (CSCS)', issuer: 'NSCA', year: 2019 },
  { title: 'Precision Nutrition Level 2', issuer: 'Precision Nutrition', year: 2021 },
  { title: 'Advanced Bodybuilding Coach Diploma', issuer: 'IFBB Academy', year: 2023 },
];

const ACHIEVEMENTS = [
  'Coached 3 podium finishes at the 2025 national championships',
  '120+ documented client transformations',
  'Former U93 national powerlifting champion',
];

const BIO = [
  'I coach lifters who want to look strong AND be strong. My programming is ' +
    'evidence-based hypertrophy with heavy compound work at its core — no ' +
    'junk volume, no guesswork, every block audited against your logs.',
  'Nutrition is handled the same way: macro targets built around food you ' +
    'actually eat, adjusted weekly from your weigh-in trend, never crash ' +
    'protocols. Contest-prep clients get a full peak-week plan.',
  'You get a personal check-in every week and a reply within 12 hours ' +
    'whenever you message me. If you put the work in, I will match it.',
].join('\n\n');

/** Public HTTPS photo (avatar_url is a plain text URL column). */
const AVATAR_URL =
  'https://images.unsplash.com/photo-1567013127542-490d757e51fc?w=800&q=80&fm=jpg';

const MILESTONES = [
  {
    title: 'First 140 kg deadlift',
    note: 'Six months of steady linear progression — perfect bracing at lockout.',
    achievedAt: '2026-05-14',
  },
  {
    title: 'Down 12 kg while holding every big-3 lift',
    note: 'Cut finished right on schedule. Strength fully preserved.',
    achievedAt: '2026-06-20',
  },
  {
    title: 'First strict muscle-up',
    note: '',
    achievedAt: '2026-07-02',
  },
];

/** Insert-or-fetch an account by email; returns its id. */
async function upsertAccount(
  db: ReturnType<typeof createDb>,
  email: string,
  displayName: string,
): Promise<string> {
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const found = existing[0];
  if (found !== undefined) {
    console.log(`account ${email} already exists (${found.id})`);
    return found.id;
  }
  const inserted = await db
    .insert(accounts)
    .values({ email, displayName, status: 'active' })
    .returning({ id: accounts.id });
  const row = inserted[0];
  if (row === undefined) throw new Error(`failed to insert account ${email}`);
  console.log(`created account ${email} (${row.id})`);
  return row.id;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL missing — put it in the repo-root .env');
  }
  const db = createDb(databaseUrl);

  // 1. Coach account (display-only: no password hash, sign-in not needed).
  const coachId = await upsertAccount(db, COACH_EMAIL, COACH_NAME);

  // 2. Staff coach role — role='coach' in admins IS the "verified" flag the
  //    discovery filter checks (together with coach_profiles.is_active).
  await db
    .insert(admins)
    .values({ accountId: coachId, role: 'coach' })
    .onConflictDoNothing({ target: admins.accountId });

  // 3. Public coach profile — upsert so re-runs refresh the portfolio.
  const profile = {
    displayName: COACH_NAME,
    headline: 'Hypertrophy & contest-prep coach — evidence-based, zero guesswork',
    bio: BIO,
    avatarUrl: AVATAR_URL,
    coachTier: 'gold' as const,
    specialties: SPECIALTIES,
    certifications: CERTIFICATIONS,
    achievements: ACHIEVEMENTS,
    yearsExperience: 8,
    capacity: 15,
    acceptingClients: true,
    replyWindowHours: 12,
    isActive: true,
  };
  await db
    .insert(coachProfiles)
    .values({ accountId: coachId, ...profile })
    .onConflictDoUpdate({ target: coachProfiles.accountId, set: profile });
  console.log('coach profile upserted');

  // 4. Demo client + active assignment (so activeClients > 0 and the
  //    milestones point at a real member account, matching the FK).
  const clientId = await upsertAccount(db, CLIENT_EMAIL, 'Demo Client');
  await db
    .insert(coachAssignments)
    .values({ coachId, userId: clientId, assignedBy: coachId, status: 'active' })
    .onConflictDoNothing({ target: [coachAssignments.coachId, coachAssignments.userId] });
  console.log('client assignment ensured');

  // 5. Coach-logged milestones — only when none exist yet (idempotent).
  const existingMilestones = await db
    .select({ id: coachMilestones.id })
    .from(coachMilestones)
    .where(and(eq(coachMilestones.coachId, coachId), eq(coachMilestones.accountId, clientId)))
    .limit(1);
  if (existingMilestones.length === 0) {
    await db
      .insert(coachMilestones)
      .values(MILESTONES.map((m) => ({ coachId, accountId: clientId, ...m })));
    console.log(`inserted ${MILESTONES.length} milestones`);
  } else {
    console.log('milestones already present — skipped');
  }

  console.log('');
  console.log(`Done. Open the coach in the app at /coaches/${coachId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
