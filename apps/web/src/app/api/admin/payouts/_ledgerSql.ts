import { sql, type SQL } from 'drizzle-orm';

/**
 * The balance-decrementing payout ledger row, written ONLY when the request is
 * actually approved.
 *
 * Approval batches two statements into one transaction: the compare-and-set
 * `pending → approved` and this insert. A batch is a transaction, not a
 * conditional: an UPDATE that matches zero rows is not an error, so the
 * transaction still commits and the insert still lands. That is exactly what
 * happens when a concurrent REJECTION wins the race — the request ends up
 * rejected while the earner's balance has already been debited for a payout
 * nobody approved, and because the insert is keyed idempotently on
 * (source_type, source_id) a retry will not repair it either.
 *
 * So the condition moves into the statement itself: `insert … select … where
 * exists (request is approved)`. Inside the same transaction the CAS's own
 * write is visible, so
 *
 *   - we won the CAS          → the request reads 'approved' → the row is written;
 *   - a rejection won         → the request reads 'rejected' → nothing is written;
 *   - another approver won    → the request reads 'approved' → the insert runs and
 *                               `on conflict do nothing` collapses it to the one
 *                               row that already exists.
 *
 * `on conflict do nothing` keeps the previous idempotency exactly as it was, so
 * the repair path for a request that is already approved with no ledger row can
 * use the same builder.
 *
 * Every parameter is cast explicitly: in an `insert … select` Postgres has no
 * target column to infer an untyped parameter from.
 */

export interface PayoutLedgerInsertParams {
  /** Primary key for the new ledger row (the tables have no database default). */
  rowId: string;
  /** The payout request this row settles, and the idempotency key with it. */
  requestId: string;
  /** Coach account id, or partner id, depending on the rail. */
  earnerId: string;
  /**
   * Signed amount, in the rail's own convention. Coach `wallet_ledger` is a
   * plain SUM so a payout is NEGATIVE; `partnerBalance` folds
   * earning + adjustment − payout so a partner payout is POSITIVE.
   */
  amountMinor: number;
  currency: string;
  note: string | null;
  /** Staff account that approved it. */
  createdBy: string;
}

function payoutLedgerInsertSql(
  params: PayoutLedgerInsertParams,
  ledgerTable: string,
  earnerColumn: string,
  requestTable: string,
): SQL {
  return sql`
    insert into ${sql.identifier(ledgerTable)} (
      id, ${sql.identifier(earnerColumn)}, type, amount_minor, currency,
      source_type, source_id, note, created_by
    )
    select
      ${params.rowId}::text,
      ${params.earnerId}::text,
      'payout',
      ${params.amountMinor}::integer,
      ${params.currency}::text,
      'payout',
      ${params.requestId}::text,
      ${params.note}::text,
      ${params.createdBy}::text
    where exists (
      select 1 from ${sql.identifier(requestTable)}
      where id = ${params.requestId} and status = 'approved'
    )
    on conflict do nothing
  `;
}

/** Coach rail. `amountMinor` must already be negative. */
export function coachPayoutLedgerInsertSql(params: PayoutLedgerInsertParams): SQL {
  return payoutLedgerInsertSql(params, 'wallet_ledger', 'coach_id', 'coach_payout_requests');
}

/** Partner rail. `amountMinor` must already be positive. */
export function partnerPayoutLedgerInsertSql(params: PayoutLedgerInsertParams): SQL {
  return payoutLedgerInsertSql(
    params,
    'partner_wallet_ledger',
    'partner_id',
    'partner_payout_requests',
  );
}
