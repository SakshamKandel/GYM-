import { accounts, admins, coachProfiles } from '@gym/db';
import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { effectivePermissionSet } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import { MembersDirectory } from './_components/MembersDirectory';
import type { CoachOption, MemberRow } from './_components/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * Roles allowed to view the member directory. Mirrors canMembers() in
 * admin/layout.tsx and the 'members.read' grant in authz.ts (super_admin +
 * member_admin + support_admin). The layout already guards the subtree, but we
 * re-check here so hitting the URL directly still fails safe.
 */
const CAN_READ = 'members.read' as const;

/** Which roles may mutate — drives whether the drawer shows action controls. */
const CAN_SUSPEND = 'members.suspend' as const;
const CAN_TIER = 'subscription.override' as const;
const CAN_ASSIGN = 'coach.assign' as const;

/**
 * Loads page 1 of the member directory directly via getDb so the first paint
 * has data with no client round-trip — email, name, tier, status, joined
 * date, plus the account's staff role (left join admins) so the drawer can
 * rank-gate suspend/reactivate on staff accounts. Shape MUST match GET
 * /api/admin/members's `members` entries (createdAt as ISO string) so later
 * client fetches (filters, "Load more") append seamlessly. Ordering is
 * asc(accounts.email) — the same stable keyset (cursor = last row's email)
 * the API pages on. Fetches PAGE_SIZE+1 to derive the initial cursor.
 */
async function loadFirstPage(): Promise<{ members: MemberRow[]; cursor: string | null }> {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      createdAt: accounts.createdAt,
      staffRole: admins.role,
    })
    .from(accounts)
    .leftJoin(admins, eq(admins.accountId, accounts.id))
    .orderBy(asc(accounts.email))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const cursor = hasMore && last ? last.email : null;

  const members: MemberRow[] = page.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    tier: r.tier,
    tierExpiresAt: r.tierExpiresAt ? r.tierExpiresAt.toISOString() : null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    staffRole: r.staffRole ?? null,
  }));

  return { members, cursor };
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
  const permissions = await effectivePermissionSet(principal);
  if (!permissions.has(CAN_READ)) redirect('/admin');

  const [{ members, cursor }, coaches] = await Promise.all([loadFirstPage(), loadCoaches()]);

  return (
    <div style={{ maxWidth: 1080 }}>
      <MembersDirectory
        initialMembers={members}
        initialCursor={cursor}
        coaches={coaches}
        callerRole={principal.role}
        canSuspend={permissions.has(CAN_SUSPEND)}
        canTier={permissions.has(CAN_TIER)}
        canAssign={permissions.has(CAN_ASSIGN)}
      />
    </div>
  );
}
