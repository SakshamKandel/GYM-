import {
  accountProfiles,
  accounts,
  coachAssignments,
  coachProfiles,
} from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminRoleOf,
  logAudit,
  requirePermission,
  requireStaff,
  requireOutranks,
} from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { type Tier, setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — a single member.
 *
 *  - GET → the member's account (email, name, tier, tierExpiresAt, status,
 *          joined), a CURATED subset of the JSON profile blob
 *          (account_profiles.data, if present — see PROFILE_ALLOWLIST; the
 *          full blob may carry free-form health/goal answers well beyond what
 *          the drawer renders, so we never ship it wholesale to every
 *          members.read holder), and the currently ASSIGNED coach (active
 *          coach_assignments row → coach identity). Guarded by
 *          requirePermission('members.read').
 *
 *  - PATCH {tier?, status?, reason?} → applies whichever fields are present.
 *          `tier` routes through setAccountTier (source of truth + jsonb mirror
 *          + audit) and is gated on 'subscription.override'; console overrides
 *          always pass `{ startsAt: new Date(), expiresAt: null }` per contract
 *          §4.4 — an admin picking a tier in this drawer means "grant this now,
 *          no expiry", never a silent no-op against a stale past expiry.
 *          `status` writes accounts.status and is gated on 'members.suspend';
 *          flipping to 'suspended' instantly kills every live session for the
 *          account because userForToken/staffForToken filter on
 *          status='active'. Neither field may target the caller's OWN account
 *          (self-suspend/self-tier-change would risk an unrecoverable
 *          lockout for a sole super_admin). Each applied field is audited.
 *          Because the two fields carry DIFFERENT permissions, we check each
 *          only when that field is supplied — a member_admin may do both, but
 *          the checks are independent and fail closed per-field.
 */

/** The only account_profiles.data keys the drawer's ProfileSummary renders.
 * The stored blob is free-form (mobile onboarding answers) and can include
 * much more than this — health/goal detail no members.read holder needs to
 * see — so GET filters to this allowlist server-side rather than trusting the
 * client to just not render the rest. */
const PROFILE_ALLOWLIST = [
  'displayName',
  'sex',
  'goalType',
  'activityLevel',
  'heightCm',
  'unitPref',
] as const;

function pickAllowedProfile(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_ALLOWLIST) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, 'members.read');
  if (guard instanceof Response) return guard;

  const { id } = await ctx.params;
  const db = getDb();

  const memberRows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  const member = memberRows[0];
  if (!member) return json({ error: 'not_found' }, 404);

  const profileRows = await db
    .select({ data: accountProfiles.data })
    .from(accountProfiles)
    .where(eq(accountProfiles.accountId, id))
    .limit(1);

  // The active coach (if any), plus that coach's public display name.
  const coachRows = await db
    .select({
      assignmentId: coachAssignments.id,
      coachId: accounts.id,
      coachEmail: accounts.email,
      coachAccountName: accounts.displayName,
      coachProfileName: coachProfiles.displayName,
    })
    .from(coachAssignments)
    .innerJoin(accounts, eq(accounts.id, coachAssignments.coachId))
    .leftJoin(coachProfiles, eq(coachProfiles.accountId, coachAssignments.coachId))
    .where(
      and(eq(coachAssignments.userId, id), eq(coachAssignments.status, 'active')),
    )
    .limit(1);

  // The member's staff role (or null) — lets the console render rank-aware
  // controls (e.g. disable Suspend when the viewer does not outrank the row).
  const staffRole = await adminRoleOf(id);

  const coachRow = coachRows[0];
  const coach = coachRow
    ? {
        assignmentId: coachRow.assignmentId,
        coachId: coachRow.coachId,
        email: coachRow.coachEmail,
        displayName:
          coachRow.coachProfileName?.trim() ||
          coachRow.coachAccountName?.trim() ||
          coachRow.coachEmail,
      }
    : null;

  return json(
    {
      member: {
        id: member.id,
        email: member.email,
        displayName: member.displayName,
        tier: member.tier,
        tierExpiresAt: member.tierExpiresAt ? member.tierExpiresAt.toISOString() : null,
        status: member.status,
        createdAt: member.createdAt,
        staffRole,
      },
      profile: pickAllowedProfile(
        profileRows[0]?.data as Record<string, unknown> | null | undefined,
      ),
      coach,
    },
    200,
  );
}

const TIERS = ['starter', 'silver', 'gold', 'elite'] as const;
const patchSchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.tier !== undefined || v.status !== undefined, {
    message: 'no_fields',
  });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Baseline: caller must at least be staff able to read members.
  const base = await requireStaff(req);
  if (base instanceof Response) return base;

  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { tier, status, reason } = parsed.data;

  const db = getDb();
  const ip = getIp(req);

  // Per-field permission checks (fail closed, independent) — run BEFORE the
  // existence lookup so a staffer lacking the relevant permission gets the
  // same 403 for real and made-up ids alike (no member-id existence oracle).
  if (tier !== undefined) {
    const g = await requirePermission(req, 'subscription.override');
    if (g instanceof Response) return g;
    // Rank guard: overriding the subscription tier of an account that holds an
    // admin role the actor does not outrank would let a lower-ranked staffer
    // rewrite a higher/peer staff account's tier (and, for 'elite', trigger a
    // coach auto-assignment). Non-staff targets always pass.
    const targetRole = await adminRoleOf(id);
    // Partner logins are managed ONLY through the Partners admin surface
    // (partners.manage, super/main-only), never this generic member drawer —
    // otherwise a member_admin (which outranks the rank-0 partner role) could
    // rewrite a restaurant account's tier, bypassing partners.manage (P1-8).
    if (targetRole === 'partner') return json({ error: 'partner_target' }, 403);
    const rankBlock = requireOutranks(base, targetRole);
    if (rankBlock) return rankBlock;
  }
  if (status !== undefined) {
    // Self-target guard: a staffer (incl. the sole super_admin) suspending
    // their OWN account kills their own session with no path back in —
    // mirrors the 'cannot_target_self' guard on admin/staff role changes.
    if (id === base.id) return json({ error: 'cannot_target_self' }, 400);
    const g = await requirePermission(req, 'members.suspend');
    if (g instanceof Response) return g;
    // Rank guard: suspending (or reactivating) an account that holds an admin
    // role the actor does not outrank would be a de-facto role takeover —
    // suspension kills every live session. Non-staff targets always pass.
    const targetRole = await adminRoleOf(id);
    // Partner logins are managed ONLY through the Partners admin surface
    // (partners.manage, super/main-only). Blocking here stops a member_admin —
    // which outranks the rank-0 partner role — from suspending a restaurant
    // login via the generic member drawer, bypassing partners.manage (P1-8).
    if (targetRole === 'partner') return json({ error: 'partner_target' }, 403);
    const rankBlock = requireOutranks(base, targetRole);
    if (rankBlock) return rankBlock;
  }

  // Target must exist. (Also the tier mirror/status update below no-op silently
  // on a missing id, so we fail early with 404 for a clean UI.) Only reachable
  // by staff who hold the permission for every supplied field.
  const existing = await db
    .select({ id: accounts.id, status: accounts.status, tier: accounts.tier })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (existing.length === 0) return json({ error: 'not_found' }, 404);

  // Apply tier via the shared helper (updates accounts.tier, mirrors the jsonb
  // blob, and writes its own 'subscription.override' audit row). Contract
  // §4.4: console overrides ALWAYS pass an explicit dated window — starting
  // now, no expiry — so granting a paid tier to a member whose stored
  // tierExpiresAt is in the past is never a silent no-op (the stale expiry
  // would otherwise keep collapsing effectiveTier() back to 'starter' even
  // though the console reported success).
  if (tier !== undefined) {
    await setAccountTier(
      id,
      tier as Tier,
      base,
      reason,
      { startsAt: new Date(), expiresAt: null },
      'console',
    );
  }

  // Apply status directly; audit here (setAccountTier only audits the tier).
  if (status !== undefined) {
    await db.update(accounts).set({ status }).where(eq(accounts.id, id));
    await logAudit(
      base,
      status === 'suspended' ? 'account.suspend' : 'account.reactivate',
      'account',
      id,
      { reason },
      ip,
    );
  }

  // Return the fresh row so the UI can update without a second round trip.
  const after = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      tier: accounts.tier,
      tierExpiresAt: accounts.tierExpiresAt,
      status: accounts.status,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  const row = after[0];
  return json(
    {
      member: row
        ? {
            ...row,
            tierExpiresAt: row.tierExpiresAt ? row.tierExpiresAt.toISOString() : null,
          }
        : null,
    },
    200,
  );
}
