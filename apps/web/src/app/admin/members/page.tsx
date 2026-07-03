import { accounts, admins, coachProfiles } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { MembersDirectory } from './_components/MembersDirectory';
import type { CoachOption, MemberRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to view the member directory. Mirrors canMembers() in
 * admin/layout.tsx and the 'members.read' grant in authz.ts (super_admin +
 * member_admin + support_admin). The layout already guards the subtree, but we
 * re-check here so hitting the URL directly still fails safe.
 */
const CAN_READ: readonly StaffRole[] = [
  'super_admin',
  'member_admin',
  'support_admin',
];

/** Which roles may mutate — drives whether the drawer shows action controls. */
const CAN_SUSPEND: readonly StaffRole[] = ['super_admin', 'member_admin'];
const CAN_TIER: readonly StaffRole[] = ['super_admin', 'member_admin'];
const CAN_ASSIGN: readonly StaffRole[] = ['super_admin', 'member_admin'];

/**
 * Loads the member directory directly via getDb — email, name, tier, status,
 * joined date. Capped so the initial render can't be unbounded; the table
 * filters client-side and the API list route (with ?q) backs deeper search.
 */
async function loadMembers(): Promise<MemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      status: accounts.status,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(asc(accounts.email))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    tier: r.tier,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * The pool of coaches an admin can assign a member to. Matches the picker in
 * the coaches page: every account with a role='coach' admins row, plus its
 * public display name (falling back to the account name / email).
 */
async function loadCoaches(): Promise<CoachOption[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      accountName: accounts.displayName,
      profileName: coachProfiles.displayName,
    })
    .from(admins)
    .innerJoin(accounts, eq(accounts.id, admins.accountId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, accounts.id))
    .where(eq(admins.role, 'coach'))
    .orderBy(asc(accounts.displayName));

  return rows.map((r) => ({
    id: r.id,
    label:
      r.profileName?.trim() || r.accountName?.trim() || r.email,
    email: r.email,
  }));
}

export default async function AdminMembersPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_READ.includes(principal.role)) redirect('/admin');

  const [members, coaches] = await Promise.all([loadMembers(), loadCoaches()]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <MembersDirectory
        members={members}
        coaches={coaches}
        canSuspend={CAN_SUSPEND.includes(principal.role)}
        canTier={CAN_TIER.includes(principal.role)}
        canAssign={CAN_ASSIGN.includes(principal.role)}
      />
    </div>
  );
}
