/**
 * Partner payout pure logic — the ledger balance fold and payout-amount bound
 * check (Pack I; §7.2-S1/S5). No I/O (CLAUDE.md rule 10). All amounts are
 * integer minor units. Net held = Σ earning + Σ adjustment − Σ payout; a payout
 * request is valid only for a positive integer amount not exceeding the held
 * balance (the IDOR/over-draw guards themselves live in the route from the
 * `requirePartner`-derived partnerId).
 */

/** Ledger row type (mirrors `partner_wallet_ledger.type`). */
export type PartnerLedgerType = 'earning' | 'adjustment' | 'payout';

/** The minimal ledger row shape {@link partnerBalance} needs. */
export interface PartnerLedgerRow {
  type: PartnerLedgerType;
  amountMinor: number;
}

/** A partner's derived balance. `heldMinor` is what is owed / withdrawable. */
export interface PartnerBalance {
  earnedMinor: number;
  adjustmentMinor: number;
  paidMinor: number;
  heldMinor: number;
}

function safeMinor(n: number): number {
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Fold a partner's ledger rows into a balance. `heldMinor` decrements as payout
 * rows are written, so — unlike the old B27 live-sum — it reflects real money
 * still held. Empty ledger → all zeros (never null/NaN).
 */
export function partnerBalance(rows: readonly PartnerLedgerRow[]): PartnerBalance {
  let earnedMinor = 0;
  let adjustmentMinor = 0;
  let paidMinor = 0;
  for (const row of rows) {
    const amount = safeMinor(row.amountMinor);
    if (row.type === 'earning') earnedMinor += amount;
    else if (row.type === 'payout') paidMinor += amount;
    else adjustmentMinor += amount;
  }
  return {
    earnedMinor,
    adjustmentMinor,
    paidMinor,
    heldMinor: earnedMinor + adjustmentMinor - paidMinor,
  };
}

/** Why a proposed payout amount was rejected. */
export type PayoutRejectReason = 'not_integer' | 'not_positive' | 'exceeds_held';

/** Result of validating a payout request amount against the held balance. */
export interface PayoutValidation {
  ok: boolean;
  reason?: PayoutRejectReason;
}

/**
 * Validate a payout request amount against the held balance (route calls this
 * after deriving `heldMinor` from the caller's OWN ledger). Amount must be a
 * positive integer `0 < amountMinor ≤ heldMinor` — no over-draw, no
 * negative/overflow. The one-pending-per-partner rule is enforced by the DB
 * partial unique, not here.
 */
export function validatePayoutAmount(amountMinor: number, heldMinor: number): PayoutValidation {
  if (!Number.isInteger(amountMinor)) return { ok: false, reason: 'not_integer' };
  if (amountMinor <= 0) return { ok: false, reason: 'not_positive' };
  if (amountMinor > heldMinor) return { ok: false, reason: 'exceeds_held' };
  return { ok: true };
}
