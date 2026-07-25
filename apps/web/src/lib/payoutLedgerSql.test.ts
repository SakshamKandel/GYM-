import assert from 'node:assert/strict';
import test from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  coachPayoutLedgerInsertSql,
  partnerPayoutLedgerInsertSql,
} from '../app/api/admin/payouts/_ledgerSql.ts';

/**
 * Payout approval batches the compare-and-set and the balance-decrementing
 * ledger row into ONE transaction. A batch is not a conditional: an UPDATE that
 * matches nothing is not an error, so before this guard existed the insert still
 * committed when a concurrent rejection won the race, and the earner's balance
 * was debited for a payout that was refused.
 *
 * The condition therefore has to live in the insert itself, which is what these
 * assertions pin. Relative imports carry the explicit `.ts` extension because
 * node's type-stripping loader needs full specifiers.
 */

const dialect = new PgDialect();
const render = (query: SQL): string => dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();

const base = {
  rowId: 'ledger_1',
  requestId: 'request_1',
  earnerId: 'earner_1',
  currency: 'NPR',
  note: 'bank ref 4471',
  createdBy: 'staff_1',
};

test('a coach payout row is only written while the request reads approved', () => {
  const query = render(coachPayoutLedgerInsertSql({ ...base, amountMinor: -25000 }));
  assert.ok(query.includes('insert into "wallet_ledger"'));
  assert.ok(query.includes('where exists ( select 1 from "coach_payout_requests"'));
  assert.ok(query.includes("status = 'approved'"));
  // Never conditioned on the state it is racing away from.
  assert.ok(!query.includes("status = 'pending'"));
  assert.ok(!query.includes("status = 'rejected'"));
  // The existing idempotency key is untouched, so a retry stays a no-op.
  assert.ok(query.includes('on conflict do nothing'));
});

test('a partner payout row carries the same approval condition', () => {
  const query = render(partnerPayoutLedgerInsertSql({ ...base, amountMinor: 25000 }));
  assert.ok(query.includes('insert into "partner_wallet_ledger"'));
  assert.ok(query.includes('where exists ( select 1 from "partner_payout_requests"'));
  assert.ok(query.includes("status = 'approved'"));
  assert.ok(query.includes('on conflict do nothing'));
});

test('each rail writes its own owner column and never the other rail table', () => {
  const coach = render(coachPayoutLedgerInsertSql({ ...base, amountMinor: -1 }));
  assert.ok(coach.includes('"coach_id"'));
  assert.ok(!coach.includes('partner_wallet_ledger'));
  assert.ok(!coach.includes('partner_payout_requests'));

  const partner = render(partnerPayoutLedgerInsertSql({ ...base, amountMinor: 1 }));
  assert.ok(partner.includes('"partner_id"'));
  assert.ok(!partner.includes('"wallet_ledger"'));
  assert.ok(!partner.includes('"coach_payout_requests"'));
});

test('the sign convention each ledger folds with is preserved end to end', () => {
  // wallet_ledger is a plain SUM, so a coach payout must be stored negative.
  const coach = dialect.sqlToQuery(coachPayoutLedgerInsertSql({ ...base, amountMinor: -25000 }));
  assert.ok(coach.params.includes(-25000));
  // partnerBalance folds earning + adjustment − payout, so a partner payout is
  // stored positive and the fold subtracts it.
  const partner = dialect.sqlToQuery(partnerPayoutLedgerInsertSql({ ...base, amountMinor: 25000 }));
  assert.ok(partner.params.includes(25000));
});

test('the row id and the idempotency key are bound, not interpolated', () => {
  const { sql: text, params } = dialect.sqlToQuery(
    coachPayoutLedgerInsertSql({ ...base, amountMinor: -25000 }),
  );
  assert.ok(!text.includes('ledger_1'));
  assert.ok(!text.includes('request_1'));
  assert.ok(params.includes('ledger_1'));
  assert.ok(params.includes('staff_1'));
  // sourceId is bound twice: once as the ledger row's key, once in the guard.
  assert.equal(params.filter((p) => p === 'request_1').length, 2);
  // Untyped parameters in an `insert … select` have no target column to be
  // inferred from, so every one of them is cast.
  assert.ok(text.includes('::text'));
  assert.ok(text.includes('::integer'));
});

test('a null note stays a real null rather than the string "null"', () => {
  const { params } = dialect.sqlToQuery(
    partnerPayoutLedgerInsertSql({ ...base, amountMinor: 1, note: null }),
  );
  assert.ok(params.includes(null));
  assert.ok(!params.includes('null'));
});
