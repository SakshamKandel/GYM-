import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TIER_PRICES,
  applyDiscount,
  formatMoney,
  resolveRegion,
  type PriceRegion,
} from './pricing.ts';

describe('resolveRegion', () => {
  it('NP (any case, trimmed) resolves to the Nepal catalog', () => {
    assert.equal(resolveRegion('NP'), 'NP');
    assert.equal(resolveRegion('np'), 'NP');
    assert.equal(resolveRegion(' Np '), 'NP');
  });

  it('every other hint clamps to INTL', () => {
    assert.equal(resolveRegion('US'), 'INTL');
    assert.equal(resolveRegion('IN'), 'INTL');
    assert.equal(resolveRegion('nepal'), 'INTL'); // full name, not the alpha-2 code — not trusted
    assert.equal(resolveRegion('xx'), 'INTL');
  });

  it('missing/empty hint defaults to INTL (fail toward the wider catalog)', () => {
    assert.equal(resolveRegion(null), 'INTL');
    assert.equal(resolveRegion(undefined), 'INTL');
    assert.equal(resolveRegion(''), 'INTL');
  });
});

describe('DEFAULT_TIER_PRICES', () => {
  it('has exactly one row per region×tier and matches the §1.1 table', () => {
    assert.equal(DEFAULT_TIER_PRICES.length, 8);

    const byKey = new Map(DEFAULT_TIER_PRICES.map((p) => [`${p.region}:${p.tier}`, p]));
    assert.equal(byKey.size, 8); // no duplicate region×tier rows

    assert.equal(byKey.get('NP:starter')?.amountMinor, 0);
    assert.equal(byKey.get('NP:silver')?.amountMinor, 49900);
    assert.equal(byKey.get('NP:gold')?.amountMinor, 99900);
    assert.equal(byKey.get('NP:elite')?.amountMinor, 299900);
    for (const tier of ['starter', 'silver', 'gold', 'elite'] as const) {
      assert.equal(byKey.get(`NP:${tier}`)?.currency, 'NPR');
    }

    assert.equal(byKey.get('INTL:starter')?.amountMinor, 0);
    assert.equal(byKey.get('INTL:silver')?.amountMinor, 499);
    assert.equal(byKey.get('INTL:gold')?.amountMinor, 999);
    assert.equal(byKey.get('INTL:elite')?.amountMinor, 2999);
    for (const tier of ['starter', 'silver', 'gold', 'elite'] as const) {
      assert.equal(byKey.get(`INTL:${tier}`)?.currency, 'USD');
    }
  });

  it('every region is a valid PriceRegion', () => {
    const regions: PriceRegion[] = ['NP', 'INTL'];
    for (const p of DEFAULT_TIER_PRICES) assert.ok(regions.includes(p.region));
  });
});

describe('applyDiscount', () => {
  it('0% pct returns the amount unchanged', () => {
    assert.equal(applyDiscount(49900, 0), 49900);
  });

  it('100% pct returns 0', () => {
    assert.equal(applyDiscount(49900, 100), 0);
  });

  it('30% off matches the coach-code / referral math exactly', () => {
    assert.equal(applyDiscount(49900, 30), 34930); // NP silver, coach/referral-adjacent pct
    assert.equal(applyDiscount(999, 30), 699); // INTL gold cents: 699.3 -> 699
  });

  it('20% off the referral-program discount', () => {
    assert.equal(applyDiscount(299900, 20), 239920);
  });

  it('rounds HALF UP at the exact .5 boundary', () => {
    assert.equal(applyDiscount(1, 50), 1); // raw 0.5 -> rounds up to 1
    assert.equal(applyDiscount(3, 50), 2); // raw 1.5 -> rounds up to 2
  });

  it('floors at 0 even for a pct over 100 (never trust caller input)', () => {
    assert.equal(applyDiscount(100, 150), 0);
    assert.equal(applyDiscount(100, 101), 0);
  });

  it('negative amountMinor never produces a positive discounted price', () => {
    assert.equal(applyDiscount(-100, 30), 0);
  });
});

describe('formatMoney', () => {
  it('NPR displays whole rupees with no decimals', () => {
    assert.equal(formatMoney(49900, 'NPR'), 'NPR 499');
    assert.equal(formatMoney(99900, 'NPR'), 'NPR 999');
    assert.equal(formatMoney(299900, 'NPR'), 'NPR 2999');
    assert.equal(formatMoney(0, 'NPR'), 'NPR 0');
  });

  it('USD displays with a $ prefix and 2 decimals', () => {
    assert.equal(formatMoney(499, 'USD'), '$4.99');
    assert.equal(formatMoney(999, 'USD'), '$9.99');
    assert.equal(formatMoney(2999, 'USD'), '$29.99');
    assert.equal(formatMoney(0, 'USD'), '$0.00');
  });

  it('currency code is case-insensitive', () => {
    assert.equal(formatMoney(499, 'usd'), '$4.99');
    assert.equal(formatMoney(49900, 'npr'), 'NPR 499');
  });

  it('an unrecognized currency falls back to "CODE amount.xx"', () => {
    assert.equal(formatMoney(500, 'EUR'), 'EUR 5.00');
  });

  it('NPR rounds a non-whole-rupee minor amount for display', () => {
    assert.equal(formatMoney(49950, 'NPR'), 'NPR 500'); // 499.5 -> rounds up
  });
});
