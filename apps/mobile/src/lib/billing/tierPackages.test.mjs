import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  packagesForTier,
  periodFromPackageType,
  periodLabel,
  sellableTiers,
  tierForEntitlements,
  tierForStorePackage,
} from './tierPackages.ts';

/**
 * The store is the one place where reading an identifier wrong charges somebody
 * for the wrong membership, so the naming contract in docs/DEPLOY.md is fenced
 * here: a package is only ever sold as the tier its identifiers name once.
 */

function pkg(overrides) {
  return {
    key: 'k',
    offeringId: 'default',
    packageId: '$rc_monthly',
    productId: 'gm_membership',
    period: 'monthly',
    priceLabel: '$9.99',
    ...overrides,
  };
}

describe('tierForStorePackage', () => {
  it('reads the tier from the offering first', () => {
    assert.equal(tierForStorePackage(pkg({ offeringId: 'gold' })), 'gold');
    assert.equal(tierForStorePackage(pkg({ offeringId: 'gm_elite_offering' })), 'elite');
  });

  it('falls back to the product, then the package identifier', () => {
    assert.equal(
      tierForStorePackage(pkg({ offeringId: 'default', productId: 'gm_silver_monthly' })),
      'silver',
    );
    assert.equal(
      tierForStorePackage(
        pkg({ offeringId: 'default', productId: 'membership', packageId: 'gold_annual' }),
      ),
      'gold',
    );
  });

  it('is case and separator insensitive', () => {
    assert.equal(tierForStorePackage(pkg({ offeringId: 'GM.Gold' })), 'gold');
  });

  it('never guesses when nothing names a tier', () => {
    assert.equal(tierForStorePackage(pkg()), null);
  });

  it('never guesses when two tiers are named at once', () => {
    assert.equal(
      tierForStorePackage(pkg({ offeringId: 'silver_to_gold_upgrade' })),
      null,
    );
  });

  it('does not match a tier hiding inside a longer word', () => {
    assert.equal(tierForStorePackage(pkg({ offeringId: 'goldish', productId: 'p' })), null);
  });
});

describe('tierForEntitlements', () => {
  it('takes the best active membership', () => {
    assert.equal(tierForEntitlements(['silver', 'gold']), 'gold');
    assert.equal(tierForEntitlements(['elite', 'silver']), 'elite');
  });

  it('ignores entitlements this app does not sell', () => {
    assert.equal(tierForEntitlements(['pro', 'plus']), null);
    assert.equal(tierForEntitlements([]), null);
  });

  it('tolerates casing and stray spaces from the dashboard', () => {
    assert.equal(tierForEntitlements([' Gold ']), 'gold');
  });
});

describe('packagesForTier', () => {
  const all = [
    pkg({ key: 'a', offeringId: 'gold', period: 'annual' }),
    pkg({ key: 'm', offeringId: 'gold', period: 'monthly' }),
    pkg({ key: 's', offeringId: 'silver', period: 'monthly' }),
    pkg({ key: 'x', offeringId: 'default', productId: 'mystery' }),
  ];

  it('returns only that tier, shortest commitment first', () => {
    assert.deepEqual(
      packagesForTier(all, 'gold').map((p) => p.key),
      ['m', 'a'],
    );
  });

  it('leaves unmapped packages out entirely', () => {
    assert.equal(packagesForTier(all, 'starter').length, 0);
    assert.deepEqual(sellableTiers(all), ['silver', 'gold']);
  });

  it('does not reorder the caller list', () => {
    packagesForTier(all, 'gold');
    assert.equal(all[0].key, 'a');
  });
});

describe('member-facing wording', () => {
  it('never shows a raw store value', () => {
    assert.equal(periodLabel(periodFromPackageType('ANNUAL')), 'Yearly');
    assert.equal(periodLabel(periodFromPackageType('THREE_MONTH')), 'Every 3 months');
    assert.equal(periodLabel(periodFromPackageType('$rc_weird')), 'Membership');
  });

  it('maps every store package type it knows', () => {
    assert.equal(periodFromPackageType('monthly'), 'monthly');
    assert.equal(periodFromPackageType('LIFETIME'), 'lifetime');
    assert.equal(periodFromPackageType(''), 'other');
  });
});
