import { admins, coachApplications, coachProfiles, promoCodes, type Db } from '@gym/db';
import { generatePromoCode } from '@gym/shared';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { adminRoleOf, logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { sendPushToAccount } from '@/lib/push';

export const runtime = 'nodejs';

/**
 * Admin console — decide a coach application (SCALE-UP-PLAN §1.4).
 *
 *  - POST {action:'approve'|'reject', coachTier?, reviewNote?} on a PENDING
 *    application. Anything else (unknown id, already-decided) 404s — mirrors
 *    /api/coach/requests/[id]'s "fetch, check status==='pending', else 404".
 *    The reviewer may never decide their own application (self-review is
 *    forbidden even for roles that otherwise hold coach.application.review).
 *
 *    approve → the CAS flip to 'approved' (guarded by a WHERE status =
 *      'pending') runs FIRST and gates everything else: only the request that
 *      wins it proceeds. This is what makes the sequence safe under a
 *      concurrent double-POST (double-click, retry, two admins) — the
 *      neon-http driver has no multi-statement transactions, so the flip
 *      itself is the only atomic checkpoint available, and promo-code
 *      minting must never run twice for the same coach. The loser 404s
 *      immediately, before touching `admins` / `coach_profiles` / promo code.
 *      The winner then, in order:
 *        1. refuses to demote an existing staff member (super_admin /
 *           main_admin / any admin role other than 'coach') — approving an
 *           application from an account that already holds a different staff
 *           role is rejected rather than silently overwriting that role
 *        2. upserts `admins` row role='coach'
 *        3. upserts `coach_profiles` from the application fields (incl.
 *           avatarUrl) + coachTier (param, default 'silver')
 *        4. generates the coach's promo code (30% discount / 30% commission)
 *           via generatePromoCode with collision-retry — SKIPPED if the coach
 *           already owns one (idempotency: a retry never mints a second code)
 *      then audits and pushes `application_decided` to the applicant.
 *
 *    reject → status + reviewNote + audit + push, no side effects.
 *
 * Guarded by requirePermission('coach.application.review').
 */

const postSchema = z.object({
  action: z.enum(['approve', 'reject']),
  coachTier: z.enum(['silver', 'gold', 'elite']).optional(),
  reviewNote: z.string().trim().max(500).optional(),
});

/**
 * Mints a unique promo code for a freshly-approved coach, retrying on a
 * unique-constraint collision (SCALE-UP-PLAN §1.3: "collision-retry"). Never
 * called when the coach already owns a code (checked by the caller).
 */
async function createCoachPromoCode(
  db: Db,
  coachId: string,
  displayName: string,
  createdBy: string,
): Promise<string> {
  const ATTEMPTS = 6;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const code = generatePromoCode(displayName);
    const inserted = await db
      .insert(promoCodes)
      .values({
        code,
        ownerCoachId: coachId,
        discountPct: 30,
        commissionPct: 30,
        createdBy,
      })
      .onConflictDoNothing({ target: promoCodes.code })
      .returning({ code: promoCodes.code });
    if (inserted[0]) return inserted[0].code;
  }
  throw new Error('createCoachPromoCode: exhausted collision retries');
}

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'coach.application.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { action, coachTier, reviewNote } = parsed.data;

  const db = getDb();

  const rows = await db
    .select({
      id: coachApplications.id,
      accountId: coachApplications.accountId,
      displayName: coachApplications.displayName,
      headline: coachApplications.headline,
      bio: coachApplications.bio,
      yearsExperience: coachApplications.yearsExperience,
      specialties: coachApplications.specialties,
      certifications: coachApplications.certifications,
      achievements: coachApplications.achievements,
      avatarUrl: coachApplications.avatarUrl,
      status: coachApplications.status,
    })
    .from(coachApplications)
    .where(eq(coachApplications.id, id))
    .limit(1);
  const application = rows[0];
  if (!application || application.status !== 'pending') {
    return json({ error: 'not_found' }, 404);
  }

  // A reviewer may never decide their own application — otherwise a
  // member_admin (who holds coach.application.review) could approve
  // themselves straight into the coach role.
  if (application.accountId === principal.id) {
    return json({ error: 'self_review_forbidden' }, 403);
  }

  const ip = req.headers.get('x-forwarded-for');

  if (action === 'reject') {
    // CAS-guard the reject exactly like approve below: if a concurrent approve
    // already flipped this row out of 'pending', our UPDATE matches 0 rows and
    // we 404 the loser — otherwise we'd audit a spurious rejection and push a
    // contradictory "not approved" notification to a just-approved coach (C5).
    const rejected = await db
      .update(coachApplications)
      .set({
        status: 'rejected',
        reviewNote: reviewNote ?? null,
        decidedBy: principal.id,
        decidedAt: new Date(),
      })
      .where(and(eq(coachApplications.id, id), eq(coachApplications.status, 'pending')))
      .returning({ id: coachApplications.id });
    if (rejected.length === 0) return json({ error: 'not_found' }, 404);

    await logAudit(
      principal,
      'coach.application.reject',
      'coach_application',
      id,
      { accountId: application.accountId, reviewNote },
      ip,
    );

    after(() =>
      sendPushToAccount(application.accountId, {
        title: 'Coach application update',
        body: 'Your coach application was not approved this time.',
        data: { type: 'application_decided' },
      }),
    );

    return json({ ok: true }, 200);
  }

  // action === 'approve'
  const tier = coachTier ?? 'silver';

  // Refuse to demote an existing staff member. Nothing upstream blocks a
  // staff account from ever having filed an application (they may have
  // applied before being promoted, or a member_admin could apply on a whim),
  // so this is the actual enforcement point: approving must never silently
  // overwrite an unrelated admin role (e.g. super_admin → coach).
  const existingRole = await adminRoleOf(application.accountId);
  if (existingRole !== null && existingRole !== 'coach') {
    return json({ error: 'target_already_staff' }, 409);
  }

  // Flip the application FIRST — the CAS UPDATE (guarded by status='pending')
  // is the only atomic checkpoint the neon-http driver gives us (no
  // multi-statement transactions), so it must gate every side effect below.
  // A concurrent double-POST (double-click, retry, two admins) now 404s the
  // loser here, before either of them touches `admins` / `coach_profiles` /
  // promo_codes — closing the race that could otherwise mint two promo codes
  // for the same coach.
  const updated = await db
    .update(coachApplications)
    .set({
      status: 'approved',
      reviewNote: reviewNote ?? null,
      decidedBy: principal.id,
      decidedAt: new Date(),
    })
    .where(and(eq(coachApplications.id, id), eq(coachApplications.status, 'pending')))
    .returning({ id: coachApplications.id });
  if (updated.length === 0) return json({ error: 'not_found' }, 404);

  // The CAS flip above committed (neon-http is per-statement, no multi-statement
  // transaction). The three side effects below are all idempotent, but if any
  // throws (transient DB blip, promo-code retry exhaustion) the application would
  // be stranded 'approved' with no role/profile/promo — and a retry would 404 at
  // the pending-check above, requiring manual DB repair (C6). Compensate: on any
  // failure, revert the row to 'pending' so a retry cleanly re-runs the whole
  // flow. The revert is CAS-guarded to our own 'approved' flip.
  try {
    // 1. Grant the staff role. The conflict update is guarded by
    // setWhere(role='coach') so a race that granted this account a DIFFERENT
    // staff role between the adminRoleOf() pre-check and here can never be
    // silently demoted to 'coach' (C7) — the update simply no-ops, leaving the
    // higher role intact. A brand-new account (no admins row) still inserts
    // role='coach' normally.
    await db
      .insert(admins)
      .values({ accountId: application.accountId, role: 'coach' })
      .onConflictDoUpdate({
        target: admins.accountId,
        set: { role: 'coach' },
        setWhere: eq(admins.role, 'coach'),
      });

    // 2. Upsert the public coach profile from the application fields — but ONLY
    // when this account isn't already a live coach (C4). Approving a stale
    // application for an existing coach must never clobber their current,
    // possibly-edited profile/tier back to the application snapshot; the role
    // grant + promo code below are idempotent, so a re-approval is otherwise a
    // no-op for them.
    if (existingRole !== 'coach') {
      const profileFields = {
        displayName: application.displayName,
        headline: application.headline,
        bio: application.bio,
        avatarUrl: application.avatarUrl,
        coachTier: tier,
        specialties: application.specialties,
        certifications: application.certifications,
        achievements: application.achievements,
        yearsExperience: application.yearsExperience,
        // Reactivate on approve: a previously-offboarded coach who re-applies has
        // a surviving coach_profiles row with isActive=false (offboardCoach keeps
        // the row for history/wallet). Without this, onConflictDoUpdate leaves the
        // stale isActive=false and the re-approved coach stays invisible in
        // discovery + un-assignable (409 'inactive'), silently breaking re-onboarding.
        isActive: true,
      };
      await db
        .insert(coachProfiles)
        .values({ accountId: application.accountId, ...profileFields })
        .onConflictDoUpdate({ target: coachProfiles.accountId, set: profileFields });
    }

    // 3. Generate the coach's promo code — idempotent: skip if one already exists
    // (a retried approve call must never mint a second code for the same coach).
    // Safe under concurrency now: only the single winner of the CAS flip above
    // ever reaches this line for a given application.
    const existingCode = await db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.ownerCoachId, application.accountId))
      .limit(1);
    if (existingCode.length === 0) {
      await createCoachPromoCode(db, application.accountId, application.displayName, principal.id);
    }
  } catch (err) {
    // Roll the application back to 'pending' so the admin can retry. Guarded so
    // we only revert the row WE just approved. Best-effort — if the revert also
    // fails the row stays 'approved' (no worse than before), so swallow it.
    try {
      await db
        .update(coachApplications)
        .set({ status: 'pending', decidedBy: null, decidedAt: null, reviewNote: null })
        .where(and(eq(coachApplications.id, id), eq(coachApplications.status, 'approved')));
    } catch {
      // ignore — surfacing the original failure matters more than the revert.
    }
    console.error('coach.application.approve: side effects failed, reverted to pending', err);
    return json({ error: 'approve_failed' }, 500);
  }

  await logAudit(
    principal,
    'coach.application.approve',
    'coach_application',
    id,
    { accountId: application.accountId, coachTier: tier },
    ip,
  );

  after(() =>
    sendPushToAccount(application.accountId, {
      title: 'Coach application approved',
      body: "You're now a verified coach on GYM Tracker.",
      data: { type: 'application_decided' },
    }),
  );

  return json({ ok: true }, 200);
}
