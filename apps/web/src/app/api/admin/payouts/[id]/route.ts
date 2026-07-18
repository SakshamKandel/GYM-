import { coachPayoutRequests, walletLedger } from '@gym/db';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { logAudit, requirePermission } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { coachWalletBalances } from '@/lib/promoEconomy';
import { sendPushToAccount } from '@/lib/push';
import { clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

/**
 * Admin console — decide a coach payout request (plan §3 P1-12).
 *
 *  - POST {action:'approve', disbursementRef, note?} on a PENDING request:
 *      * re-checks the coach's LIVE ledger balance (recomputed at decision
 *        time, never trusting the request-time snapshot) — a request that is no
 *        longer covered by the balance 409s;
 *      * CAS pending→approved (the WHERE status='pending' write is the race /
 *        commit point);
 *      * posts the negative `wallet_ledger` payout entry, idempotently keyed
 *        (sourceType='payout', sourceId=requestId) via the unique
 *        (source_type, source_id) index — so a retry after a partial failure
 *        (CAS flipped, ledger insert crashed) repairs itself without
 *        double-debiting the wallet.
 *      disbursementRef (the eSewa/Khalti/bank transaction reference for the
 *      actual out-of-app disbursement) is REQUIRED.
 *  - POST {action:'reject', note?}: CAS pending→rejected, which frees the
 *    coach's one-pending slot so they can file again. No ledger movement.
 *
 * Approval is idempotently re-runnable: a request already 'approved' (a retry,
 * or a partial failure) re-attempts only the idempotent ledger insert and
 * returns ok, never re-checking the floor or re-auditing. Money is always
 * integer minor units; the balance is recomputed from the ledger at decision
 * time. Guarded by requirePermission('payouts.review').
 */

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    disbursementRef: z.string().trim().min(1).max(200),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('reject'),
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

  const db = getDb();
  const ip = clientIp(req);

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

  // ---- reject -------------------------------------------------------------
  if (body.action === 'reject') {
    if (request.status !== 'pending') return json({ error: 'already_decided' }, 409);
    const closed = await db
      .update(coachPayoutRequests)
      .set({
        status: 'rejected',
        note: body.note ?? null,
        decidedBy: principal.id,
        decidedAt: new Date(),
      })
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

  // ---- approve ------------------------------------------------------------
  // A refunded/rejected/paid request can never be approved.
  if (request.status !== 'pending' && request.status !== 'approved') {
    return json({ error: 'already_decided' }, 409);
  }

  let flipped = false;
  if (request.status === 'pending') {
    // Balance floor at DECISION time — recompute from the ledger. Between this
    // check and the CAS flip below no payout row exists yet, so the balance is
    // authoritative; the ledger insert only happens AFTER a successful flip.
    const balances = await coachWalletBalances(request.coachId);
    const balanceMinor =
      balances.find((b) => b.currency === request.currency)?.amountMinor ?? 0;
    if (balanceMinor < request.amountMinor) {
      return json({ error: 'insufficient_balance', balanceMinor, currency: request.currency }, 409);
    }

    const updated = await db
      .update(coachPayoutRequests)
      .set({
        status: 'approved',
        disbursementRef: body.disbursementRef,
        note: body.note ?? null,
        decidedBy: principal.id,
        decidedAt: new Date(),
      })
      .where(and(eq(coachPayoutRequests.id, id), eq(coachPayoutRequests.status, 'pending')))
      .returning({ id: coachPayoutRequests.id });

    if (updated.length === 0) {
      // Lost the race to a concurrent approver. Re-read: if it is now approved,
      // fall through to the idempotent ledger repair; otherwise it was decided
      // some other way.
      const [now] = await db
        .select({ status: coachPayoutRequests.status })
        .from(coachPayoutRequests)
        .where(eq(coachPayoutRequests.id, id))
        .limit(1);
      if (now?.status !== 'approved') return json({ error: 'already_decided' }, 409);
    } else {
      flipped = true;
    }
  }

  // Idempotent ledger write (repairs a partial failure where the CAS flipped
  // but this insert never landed). The unique (source_type, source_id) index
  // makes a re-run a no-op — the wallet is debited at most once per request.
  await db
    .insert(walletLedger)
    .values({
      coachId: request.coachId,
      type: 'payout',
      amountMinor: -Math.abs(request.amountMinor),
      currency: request.currency,
      sourceType: 'payout',
      sourceId: request.id,
      note: body.disbursementRef,
      createdBy: principal.id,
    })
    .onConflictDoNothing();

  // Audit + notify only on the genuine pending→approved transition (never on a
  // retry / concurrent-loser repair path).
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
        disbursementRef: body.disbursementRef,
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
