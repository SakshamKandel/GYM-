import { accounts, admins, coachProfiles, promoCodes } from '@gym/db';
import { asc, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { PageHeader, StatTile } from '@/components/console';
import type { StaffRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { staffFromCookie } from '@/lib/staffSession';
import {
  type CoachOption,
  type PromoCodeRow,
  PromoManager,
} from './_components/PromoManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roles allowed to manage promo codes. Mirrors the 'promo.manage' grant in
 * authz.ts — super_admin + main_admin ONLY (not member_admin), per
 * SCALE-UP-PLAN §4: "promo + pricing super/main only". The layout hides the
 * nav link for anyone else, but we re-check here so the URL still fails safe.
 */
const CAN_MANAGE: readonly StaffRole[] = ['super_admin', 'main_admin'];

/**
 * Loads every promo code, newest first, with the owning coach's display label
 * (coach profile name, falling back to the account name/email) when the code
 * is coach-owned. House codes (ownerCoachId null) render as null → the client
 * shows "House".
 */
async function loadCodes(): Promise<PromoCodeRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: promoCodes.id,
      code: promoCodes.code,
      ownerCoachId: promoCodes.ownerCoachId,
      ownerAccountEmail: accounts.email,
      ownerAccountName: accounts.displayName,
      ownerProfileName: coachProfiles.displayName,
      discountPct: promoCodes.discountPct,
      commissionPct: promoCodes.commissionPct,
      active: promoCodes.active,
      maxRedemptions: promoCodes.maxRedemptions,
      redemptionCount: promoCodes.redemptionCount,
      expiresAt: promoCodes.expiresAt,
      createdAt: promoCodes.createdAt,
    })
    .from(promoCodes)
    .leftJoin(accounts, eq(accounts.id, promoCodes.ownerCoachId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, promoCodes.ownerCoachId))
    .orderBy(desc(promoCodes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    ownerCoachId: r.ownerCoachId,
    ownerLabel: r.ownerCoachId
      ? r.ownerProfileName?.trim() || r.ownerAccountName?.trim() || r.ownerAccountEmail
      : null,
    discountPct: r.discountPct,
    commissionPct: r.commissionPct,
    active: r.active,
    maxRedemptions: r.maxRedemptions,
    redemptionCount: r.redemptionCount,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Every account holding the coach role, for the "coach code" owner picker. */
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
    label: r.profileName?.trim() || r.accountName?.trim() || r.email,
  }));
}

export default async function AdminPromosPage() {
  const principal = await staffFromCookie();
  if (!principal) redirect('/admin/login');
  if (!CAN_MANAGE.includes(principal.role)) redirect('/admin');

  const [codes, coaches] = await Promise.all([loadCodes(), loadCoaches()]);
  const activeCount = codes.filter((c) => c.active).length;
  const totalRedemptions = codes.reduce((n, c) => n + c.redemptionCount, 0);

  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Promo codes"
        subtitle="Every verified coach gets an automatic 30%-off / 30%-commission code. Create house codes here for one-off promotions."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <StatTile label="Codes" value={codes.length} />
        <StatTile label="Active" value={activeCount} />
        <StatTile label="Total redemptions" value={totalRedemptions} />
      </div>

      <PromoManager codes={codes} coaches={coaches} />
    </div>
  );
}
