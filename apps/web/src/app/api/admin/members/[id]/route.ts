import {
  accountProfiles,
  accounts,
  coachAssignments,
  coachProfiles,
} from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { logAudit, requirePermission, requireStaff } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { type Tier, setAccountTier } from '@/lib/tier';

export const runtime = 'nodejs';

/**
 * Admin console — a single member.
 *
 *  - GET → the member's account (email, name, tier, status, joined), the JSON
 *          profile blob (account_profiles.data, if present), and the currently
 *          ASSIGNED coach (active coach_assignments row → coach identity).
 *          Guarded by requirePermission('members.read').
 *
 *  - PATCH {tier?, status?, reason?} → applies whichever fields are present.
 *          `tier` routes through setAccountTier (source of truth + jsonb mirror
 *          + audit) and is gated on 'subscription.override'. `status` writes
 *          accounts.status and is gated on 'members.suspend'; flipping to
 *          'suspended' instantly kills every live session for the account
 *          because userForToken/staffForToken filter on status='active'. Each
 *          applied field is audited. Because the two fields carry DIFFERENT
 *          permissions, we check each only when that field is supplied — a
 *          member_admin may do both, but the checks are independent and fail
 *          closed per-field.
 */

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
        status: member.status,
        createdAt: member.createdAt,
      },
      profile: profileRows[0]?.data ?? null,
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

  // Target must exist. (Also the tier mirror/status update below no-op silently
  // on a missing id, so we fail early with 404 for a clean UI.)
  const existing = await db
    .select({ id: accounts.id, status: accounts.status, tier: accounts.tier })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (existing.length === 0) return json({ error: 'not_found' }, 404);

  // Per-field permission checks (fail closed, independent).
  if (tier !== undefined) {
    const g = await requirePermission(req, 'subscription.override');
    if (g instanceof Response) return g;
  }
  if (status !== undefined) {
    const g = await requirePermission(req, 'members.suspend');
    if (g instanceof Response) return g;
  }

  // Apply tier via the shared helper (updates accounts.tier, mirrors the jsonb
  // blob, and writes its own 'subscription.override' audit row).
  if (tier !== undefined) {
    await setAccountTier(id, tier as Tier, base, reason);
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
      status: accounts.status,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  return json({ member: after[0] }, 200);
}
