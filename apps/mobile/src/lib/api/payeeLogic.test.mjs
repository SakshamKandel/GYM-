import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { availableRails, payableRails, supportsRail } from './payeeLogic.ts';

/**
 * The rule these tests fence: a payment rail is offered ONLY when a member can
 * see where the money goes.
 *
 * Manual payment is the only working way to buy anything in this app, and every
 * receipt screen used to say "transfer first, then upload the receipt" while no
 * wallet, account or QR existed anywhere in the product. So the failing case
 * here is not cosmetic: a rail that reads as payable with no destination behind
 * it sends a member's money nowhere.
 */

/** Nothing configured at all. */
const EMPTY = {
  esewa: null,
  khalti: null,
  bank: null,
  qrImageUrl: null,
  instructions: null,
};

const WALLETS_ONLY = {
  ...EMPTY,
  esewa: { id: '9800000000', name: 'GM Method' },
  khalti: { id: '9811111111', name: null },
};

const BANK_ONLY = {
  ...EMPTY,
  bank: { bankName: 'Nabil Bank', accountName: 'GM Method', accountNumber: '0123456789' },
};

/** A QR and a note, but no id and no account: still nowhere to send money. */
const EXTRAS_ONLY = {
  ...EMPTY,
  qrImageUrl: 'https://example.test/qr.png',
  instructions: 'Put your name in the remarks',
};

describe('supportsRail', () => {
  it('says no to every rail when there is no payee at all', () => {
    for (const rail of ['esewa', 'khalti', 'bank']) {
      assert.equal(supportsRail(null, rail), false);
    }
  });

  it('says no to every rail when nothing is filled in', () => {
    for (const rail of ['esewa', 'khalti', 'bank']) {
      assert.equal(supportsRail(EMPTY, rail), false);
    }
  });

  it('offers only the wallets that have an id', () => {
    assert.equal(supportsRail(WALLETS_ONLY, 'esewa'), true);
    assert.equal(supportsRail(WALLETS_ONLY, 'khalti'), true);
    assert.equal(supportsRail(WALLETS_ONLY, 'bank'), false);
  });

  it('offers the bank only when the account is there', () => {
    assert.equal(supportsRail(BANK_ONLY, 'bank'), true);
    assert.equal(supportsRail(BANK_ONLY, 'esewa'), false);
  });

  it('never turns a QR or a note into a payable rail', () => {
    assert.deepEqual(availableRails(EXTRAS_ONLY), []);
  });
});

describe('availableRails', () => {
  it('lists nothing when nothing is configured', () => {
    assert.deepEqual(availableRails(null), []);
    assert.deepEqual(availableRails(EMPTY), []);
  });

  it('lists rails in the order surfaces show them', () => {
    const all = { ...WALLETS_ONLY, bank: BANK_ONLY.bank };
    assert.deepEqual(availableRails(all), ['esewa', 'khalti', 'bank']);
  });
});

describe('payableRails', () => {
  it('drops a wanted rail that has no destination', () => {
    // Nepal offers all three; only the wallets are configured.
    assert.deepEqual(payableRails(['esewa', 'khalti', 'bank'], WALLETS_ONLY), ['esewa', 'khalti']);
  });

  it('returns nothing when the wanted rail is unconfigured', () => {
    // Outside Nepal only bank transfer is offered, and it is not set up.
    assert.deepEqual(payableRails(['bank'], WALLETS_ONLY), []);
  });

  it('keeps the caller order, not the payee order', () => {
    const all = { ...WALLETS_ONLY, bank: BANK_ONLY.bank };
    assert.deepEqual(payableRails(['bank', 'esewa'], all), ['bank', 'esewa']);
  });
});
