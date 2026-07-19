import {
  coachPayoutRequests,
  mealPartners,
  partnerPayoutRequests,
  partnerWalletLedger,
  walletLedger,
} from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { notify } from '@/lib/notify';
import { coachWalletBalances } from '@/lib/promoEconomy';
import { sendPushToAccount } from '@/lib/push';
import { clientIp } from '@/lib/rateLimit';
import { loadPartnerHeld } from '@/app/partner/_data';

export const runtime = 'nodejs';

/**
 * Admin console — decide an earner payout request (plan §3 P1-12 · WP-5 Pack I).
 * Handles BOTH earner rails via `scope` (default 'coach' — the original,
 * unchanged behavior; 'partner' — the mirrored partner rail).
 *
 *  - POST {action:'approve', scope?, disbursementRef, note?} on a PENDING request:
 *      * re-checks the earner's LIVE balance at decision time (never the request-
 *        time snapshot) — a request no longer covered 409s;
 *      * CAS pending→approved (the WHERE status='pending' write is the commit
 *        point);
 *      * posts the negative wallet-ledger payout entry, idempotently keyed
 *        (sourceType='payout', sourceId=requestId) via the unique
 *        (source_type, source_id) index — so a retry after a partial failure
 *        (CAS flipped, ledger insert crashed) repairs itself without double-
 *        debiting. disbursementRef is REQUIRED.
 *  - POST {action:'reject', scope?, note?}: CAS pending→rejected, freeing the
 *    one-pending slot so the earner can file again. No ledger movement.
 *
 * Approval is idempotently re-runnable. Money is always integer minor units;
 * the balance is recomputed from the ledger at decision time. Guarded by
 * requirePermission('payouts.review').
 */

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    scope: z.enum(['coach', 'partner']).default('coach'),
    disbursementRef: z.string().trim().min(1).max(200),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    scope: z.enum(['coach', 'partner']).default('coach'),
    note: z.string().trim().max(500).optional(),
  }),
]);

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission(req, 'payouts.review');
  if (principal instanceof Response) return principal;

  const { id } = await params;

  const parsed = postSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const body = parsed.data;

  if (body.scope === 'partner') return decidePartner(principal, id, body, clientIp(req));
  return decideCoach(principal, id, body, clientIp(req));
}

// ── Coach rail (original behavior — unchanged) ──────────────────────────────
async function decideCoach(
  principal: Extract<Awaited<ReturnType<typeof requirePermission>>, { id: string }>,
  id: string,
  body: z.infer<typeof postSchema>,
  ip: string | null,
) {
  const db = getDb();

  const rows = await db
    .select({
      id: coachPayoutRequests.id,
      coachId: coachPayoutRequests.coachId,
      currency: coachPayoutRequests.currency,
      amountMinor: coachPayoutRequests.amountMinor,
      status: coachPayoutRequests.status,
    })
    .from(coachPayoutRequests)
    .where(eq(coachPayoutRequests.id, id))
    .limit(1);
  const request = rows[0];
  if (!request) return json({ error: 'not_found' }, 404);

  if (body.action === 'reject') {
    if (request.status !== 'pending') return json({ error: 'already_decided' }, 409);
    const closed = await db
      .update(coachPayoutRequests)
      .set({ status: 'rejected', note: body.note ?? null, decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(coachPayoutRequests.id, id), eq(coachPayoutRequests.status, 'pending')))
      .returning({ id: coachPayoutRequests.id });
    if (closed.length === 0) return json({ error: 'already_decided' }, 409);

    await logAudit(
      principal,
      'payout.reject',
      'coach_payout_request',
      id,
      { coachId: request.coachId, amountMinor: request.amountMinor, currency: request.currency },
      ip,
    );

    after(() =>
      sendPushToAccount(request.coachId, {
        title: 'Payout request update',
        body: 'Your payout request was not approved this time.',
        data: { type: 'payout_decided' },
      }),
    );

    return json({ ok: true }, 200);
  }

  // ---- approve ----
  if (request.status !== 'pending' && request.status !== 'approved') {
    return json({ error: 'already_decided' }, 409);
  }

  const disbursementRef = body.action === 'approve' ? body.disbursementRef : '';

  // The decrementing payout ledger row (coach `wallet_ledger` is a plain SUM, so
  // payouts are stored NEGATIVE). Idempotent via unique (source_type, source_id).
  const ledgerValues = {
    coachId: request.coachId,
    type: 'payout' as const,
    amountMinor: -Math.abs(request.amountMinor),
    currency: request.currency,
    sourceType: 'payout',
    sourceId: request.id,
    note: body.action === 'approve' ? body.disbursementRef : null,
    createdBy: principal.id,
  };

  let flipped = false;
  if (request.status === 'pending') {
    const balances = await coachWalletBalances(request.coachId);
    const balanceMinor = balances.find((b) => b.currency === request.currency)?.amountMinor ?? 0;
    if (balanceMinor < request.amountMinor) {
      return json({ error: 'insufficient_balance', balanceMinor, currency: request.currency }, 409);
    }

    // ATOMIC approve: CAS flip + decrementing payout row commit together in one
    // transaction (neon-http `db.batch`). A mid-tx failure rolls back to 'pending'
    // with no ledger row — never the split state that frees the one-pending slot
    // while the balance was never debited (§7.1 WP-5).
    const [updated] = await db.batch([
      db
        .update(coachPayoutRequests)
        .set({
          status: 'approved',
          disbursementRef,
          note: body.note ?? null,
          decidedBy: principal.id,
          decidedAt: new Date(),
        })
        .where(and(eq(coachPayoutRequests.id, id), eq(coachPayoutRequests.status, 'pending')))
        .returning({ id: coachPayoutRequests.id }),
      db.insert(walletLedger).values(ledgerValues).onConflictDoNothing(),
    ]);

    if (updated.length === 0) {
      const [now] = await db
        .select({ status: coachPayoutRequests.status })
        .from(coachPayoutRequests)
        .where(eq(coachPayoutRequests.id, id))
        .limit(1);
      if (now?.status !== 'approved') return json({ error: 'already_decided' }, 409);
    } else {
      flipped = true;
    }
  } else {
    // Already 'approved' on entry — idempotent repair insert for a prior partial
    // failure that left the request approved with no ledger row.
    await db.insert(walletLedger).values(ledgerValues).onConflictDoNothing();
  }

  if (flipped) {
    await logAudit(
      principal,
      'payout.approve',
      'coach_payout_request',
      id,
      {
        coachId: request.coachId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        disbursementRef: body.action === 'approve' ? body.disbursementRef : undefined,
      },
      ip,
    );

    after(() =>
      sendPushToAccount(request.coachId, {
        title: 'Payout approved',
        body: 'Your payout has been approved and disbursed.',
        data: { type: 'payout_decided' },
      }),
    );
  }

  return json({ ok: true }, 200);
}

// ── Partner rail (mirrors the coach rail) ───────────────────────────────────
async function decidePartner(
  principal: Extract<Awaited<ReturnType<typeof requirePermission>>, { id: string }>,
  id: string,
  body: z.infer<typeof postSchema>,
  ip: string | null,
) {
  const db = getDb();

  const rows = await db
    .select({
      id: partnerPayoutRequests.id,
      partnerId: partnerPayoutRequests.partnerId,
      currency: partnerPayoutRequests.currency,
      amountMinor: partnerPayoutRequests.amountMinor,
      status: partnerPayoutRequests.status,
    })
    .from(partnerPayoutRequests)
    .where(eq(partnerPayoutRequests.id, id))
    .limit(1);
  const request = rows[0];
  if (!request) return json({ error: 'not_found' }, 404);

  // ---- reject ----
  if (body.action === 'reject') {
    if (request.status !== 'pending') return json({ error: 'already_decided' }, 409);
    const closed = await db
      .update(partnerPayoutRequests)
      .set({ status: 'rejected', note: body.note ?? null, decidedBy: principal.id, decidedAt: new Date() })
      .where(and(eq(partnerPayoutRequests.id, id), eq(partnerPayoutRequests.status, 'pending')))
      .returning({ id: partnerPayoutRequests.id });
    if (closed.length === 0) return json({ error: 'already_decided' }, 409);

    await logAudit(
      principal,
      'payout.reject',
      'partner_payout_request',
      id,
      { partnerId: request.partnerId, amountMinor: request.amountMinor, currency: request.currency },
      ip,
    );

    // Server-templated content — no user free text (§7.2-S2). Fire-and-forget.
    void notify(
      'payout_status_partner',
      { partnerId: request.partnerId },
      {
        title: 'Payout request update',
        body: 'Your payout request was not approved this time.',
        data: { type: 'payout' },
      },
    );

    return json({ ok: true }, 200);
  }

  // ---- approve ----
  if (request.status !== 'pending' && request.status !== 'approved') {
    return json({ error: 'already_decided' }, 409);
  }

  const disbursementRef = body.action === 'approve' ? body.disbursementRef : '';

  // The decrementing payout ledger row. Idempotent via the unique
  // (source_type, source_id) index — a re-run is a no-op, so held decrements
  // EXACTLY once per approved request.
  //
  // NOTE the sign convention: `partnerBalance` (@gym/shared) computes
  // held = Σearning + Σadjustment − Σpayout, so a `payout` row carries the
  // POSITIVE magnitude and the fold subtracts it (unlike the coach `wallet_ledger`
  // which is a plain SUM and stores payouts negative).
  const ledgerValues = {
    partnerId: request.partnerId,
    type: 'payout' as const,
    amountMinor: Math.abs(request.amountMinor),
    currency: request.currency,
    sourceType: 'payout',
    sourceId: request.id,
    note: disbursementRef,
    createdBy: principal.id,
  };

  let flipped = false;
  if (request.status === 'pending') {
    // Balance floor at DECISION time — recompute the held balance from the
    // ledger (nets out prior payouts). The pending request's amount is not yet
    // in the ledger, so the balance must still cover it.
    const held = await loadPartnerHeld(db, request.partnerId, request.currency);
    if (held.heldMinor < request.amountMinor) {
      return json(
        { error: 'insufficient_balance', heldMinor: held.heldMinor, currency: request.currency },
        409,
      );
    }

    // ATOMIC approve: the CAS flip and the decrementing payout row commit together
    // in one transaction (neon-http `db.batch`). A mid-tx failure rolls the status
    // back to 'pending' with NO ledger row — never the split state where the
    // request reads 'approved' but held never decremented, which would free the
    // one-pending slot and let the same balance be disbursed twice (§7.1 WP-5).
    const [updated] = await db.batch([
      db
        .update(partnerPayoutRequests)
        .set({
          status: 'approved',
          disbursementRef,
          note: body.note ?? null,
          decidedBy: principal.id,
          decidedAt: new Date(),
        })
        .where(and(eq(partnerPayoutRequests.id, id), eq(partnerPayoutRequests.status, 'pending')))
        .returning({ id: partnerPayoutRequests.id }),
      db.insert(partnerWalletLedger).values(ledgerValues).onConflictDoNothing(),
    ]);

    if (updated.length === 0) {
      // Lost the race — a concurrent approver won; our batched insert was an
      // idempotent no-op. Re-read: if now approved, treat as success (not flipped
      // by us); otherwise it was rejected/paid elsewhere.
      const [now] = await db
        .select({ status: partnerPayoutRequests.status })
        .from(partnerPayoutRequests)
        .where(eq(partnerPayoutRequests.id, id))
        .limit(1);
      if (now?.status !== 'approved') return json({ error: 'already_decided' }, 409);
    } else {
      flipped = true;
    }
  } else {
    // Already 'approved' on entry — a prior partial failure may have left the row
    // approved with no ledger entry. Idempotent repair insert (no CAS needed).
    await db.insert(partnerWalletLedger).values(ledgerValues).onConflictDoNothing();
  }

  if (flipped) {
    await logAudit(
      principal,
      'payout.approve',
      'partner_payout_request',
      id,
      {
        partnerId: request.partnerId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        disbursementRef,
      },
      ip,
    );

    void notify(
      'payout_status_partner',
      { partnerId: request.partnerId },
      {
        title: 'Payout approved',
        body: 'Your payout has been approved and disbursed.',
        data: { type: 'payout' },
      },
    );
  }

  return json({ ok: true }, 200);
}
