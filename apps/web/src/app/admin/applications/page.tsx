import { accounts, coachApplications } from '@gym/db';
import { desc, eq, ne } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import { effectivePermissionSet } from '@/lib/authz';
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

/** Cap on DECIDED (approved/rejected) history only — pending is loaded in full
 * so old, still-actionable applications can never fall off the bottom of a
 * fixed newest-N window (C14). */
const DECIDED_CAP = 300;

/**
 * Loads coach applications joined to the applicant's account for email/name.
 * PENDING applications are loaded unbounded — they're the work queue and must
 * never be hidden by a cap — while decided (approved/rejected) history is capped
 * (C14). Portfolios are small text/jsonb blobs, so loading the full row here
 * means the detail drawer needs no per-row fetch.
 */
async function loadApplications(): Promise<ApplicationRow[]> {
  const db = getDb();
  const cols = {
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
  };

  const [pendingRows, decidedRows] = await Promise.all([
    db
      .select(cols)
      .from(coachApplications)
      .innerJoin(accounts, eq(accounts.id, coachApplications.accountId))
      .where(eq(coachApplications.status, 'pending'))
      .orderBy(desc(coachApplications.createdAt)),
    db
      .select(cols)
      .from(coachApplications)
      .innerJoin(accounts, eq(accounts.id, coachApplications.accountId))
      .where(ne(coachApplications.status, 'pending'))
      .orderBy(desc(coachApplications.createdAt))
      .limit(DECIDED_CAP),
  ]);

  return [...pendingRows, ...decidedRows].map((r) => ({
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
  const permissions = await effectivePermissionSet(principal);
  const canReview = permissions.has('coach.application.review');
  if (!canReview) redirect('/admin');

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

      <ApplicationsManager applications={applications} canReview={canReview} />
    </div>
  );
}
