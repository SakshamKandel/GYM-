import { accounts, coachApplications } from '@gym/db';
import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import {
  type ApplicationRow,
  ApplicationsManager,
} from './_components/ApplicationsManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to review coach applications. Mirrors the 'coach.application.review'
 * grant in authz.ts (super_admin + main_admin + member_admin). The admin layout
 * hides the nav link and guards the subtree for anyone outside ADMIN_ROLES, but
 * we re-check the specific permission here so hitting the URL directly still
 * fails safe.
 */
const CAN_REVIEW: readonly StaffRole[] = ['super_admin', 'main_admin', 'member_admin'];

const CAP = 300;

/**
 * Loads every coach application (any status), newest first, joined to the
 * applicant's account for email/name. Portfolios are small text/jsonb blobs —
 * loading the full row here means the detail drawer needs no per-row fetch.
 */
async function loadApplications(): Promise<ApplicationRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: coachApplications.id,
      accountId: coachApplications.accountId,
      accountEmail: accounts.email,
      accountDisplayName: accounts.displayName,
      displayName: coachApplications.displayName,
      headline: coachApplications.headline,
      bio: coachApplications.bio,
      yearsExperience: coachApplications.yearsExperience,
      specialties: coachApplications.specialties,
      certifications: coachApplications.certifications,
      achievements: coachApplications.achievements,
      avatarUrl: coachApplications.avatarUrl,
      status: coachApplications.status,
      reviewNote: coachApplications.reviewNote,
      createdAt: coachApplications.createdAt,
      decidedAt: coachApplications.decidedAt,
    })
    .from(coachApplications)
    .innerJoin(accounts, eq(accounts.id, coachApplications.accountId))
    .orderBy(desc(coachApplications.createdAt))
    .limit(CAP);

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountEmail: r.accountEmail,
    accountDisplayName: r.accountDisplayName,
    displayName: r.displayName,
    headline: r.headline,
    bio: r.bio,
    yearsExperience: r.yearsExperience,
    specialties: r.specialties,
    certifications: r.certifications,
    achievements: r.achievements,
    avatarUrl: r.avatarUrl,
    status: r.status as ApplicationRow['status'],
    reviewNote: r.reviewNote,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  }));
}

export default async function AdminApplicationsPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_REVIEW.includes(principal.role)) redirect('/admin');

  const applications = await loadApplications();
  const pending = applications.filter((a) => a.status === 'pending').length;
  const approved = applications.filter((a) => a.status === 'approved').length;
  const rejected = applications.filter((a) => a.status === 'rejected').length;

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Coach applications"
        subtitle="Review self-serve coach applications. Approving grants the coach role, publishes a profile, and generates the coach's promo code."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Total" value={applications.length} />
        <StatTile label="Pending" value={pending} />
        <StatTile label="Approved" value={approved} />
        <StatTile label="Rejected" value={rejected} />
      </div>

      <ApplicationsManager applications={applications} canReview={CAN_REVIEW.includes(principal.role)} />
    </div>
  );
}
