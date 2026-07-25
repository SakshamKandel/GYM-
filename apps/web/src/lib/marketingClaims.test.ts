import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tier } from '@gym/shared';
// Deep .ts imports so `node --test` can run this without a build step, the
// same way deliveryEligibility.ts reaches into @gym/shared.
import { minTierFor, type Feature } from '@gym/shared/src/logic/entitlements.ts';
import { TIER_ORDER } from '@gym/shared/src/logic/gmMethod.ts';
import {
  BULLET_GROUPS,
  comparisonGroups,
  inheritsFrom,
  TIER_BULLETS,
  TIER_META,
  totalBulletCount,
} from '../components/marketing/pricing-format.ts';

/**
 * The marketing site may only promise what the app actually unlocks.
 *
 * Every tier bullet on the pricing page, the home teaser and the comparison
 * table comes from TIER_BULLETS, and every bullet there names an entitlement
 * from @gym/shared. This test is the gate: invent a claim, or list a real
 * feature under the wrong tier, and the build fails here instead of shipping.
 */

const TIER_IDS = TIER_META.map((t) => t.tier);

describe('marketing tier claims', () => {
  it('uses the same tier ids and ladder order as the app', () => {
    assert.deepEqual(TIER_IDS, TIER_ORDER);
  });

  it('backs every bullet with an entitlement that exists in @gym/shared', () => {
    for (const tier of TIER_IDS) {
      for (const bullet of TIER_BULLETS[tier]) {
        // minTierFor only answers for real Feature keys — an invented one
        // resolves to undefined and fails here.
        const min: Tier | undefined = minTierFor(bullet.feature);
        assert.ok(
          min !== undefined,
          `"${bullet.label}" names an entitlement that does not exist: ${bullet.feature}`,
        );
      }
    }
  });

  it('lists every bullet under the tier that actually unlocks it', () => {
    for (const tier of TIER_IDS) {
      for (const bullet of TIER_BULLETS[tier]) {
        assert.equal(
          minTierFor(bullet.feature),
          tier,
          `"${bullet.label}" is sold as ${tier} but the app unlocks ${bullet.feature} at ${minTierFor(bullet.feature)}`,
        );
      }
    }
  });

  it('never sells a feature the app does not gate at all', () => {
    // Guards against a bullet typed loosely (e.g. via a cast) sneaking past.
    const known = new Set<Feature>(TIER_IDS.flatMap((t) => TIER_BULLETS[t].map((b) => b.feature)));
    for (const feature of known) {
      assert.ok(TIER_ORDER.includes(minTierFor(feature)), `${feature} is not a gated feature`);
    }
  });

  it('keeps bullet copy unique and grouped', () => {
    const labels = TIER_IDS.flatMap((t) => TIER_BULLETS[t].map((b) => b.label));
    assert.equal(new Set(labels).size, labels.length, 'duplicate bullet copy');
    assert.equal(labels.length, totalBulletCount());

    for (const tier of TIER_IDS) {
      for (const bullet of TIER_BULLETS[tier]) {
        assert.ok(
          BULLET_GROUPS.includes(bullet.group),
          `"${bullet.label}" has an unknown group: ${bullet.group}`,
        );
        assert.ok(bullet.label.trim().length > 0, 'empty bullet copy');
      }
    }
  });

  it('gives the free tier something real and every paid tier something extra', () => {
    for (const tier of TIER_IDS) {
      assert.ok(TIER_BULLETS[tier].length > 0, `${tier} has no bullets`);
    }
    assert.equal(inheritsFrom('starter'), null);
    assert.equal(inheritsFrom('silver'), 'Everything in Starter');
    assert.equal(inheritsFrom('gold'), 'Everything in Silver');
    assert.equal(inheritsFrom('elite'), 'Everything in Gold');
  });
});

describe('marketing comparison table', () => {
  it('ticks a row from the unlocking tier upward, and never below it', () => {
    for (const group of comparisonGroups()) {
      for (const row of group.rows) {
        const first = row.tiers.indexOf(true);
        assert.notEqual(first, -1, `"${row.label}" is included in no tier`);
        // Once included, included for every tier above — the ladder never dips.
        assert.deepEqual(
          row.tiers,
          row.tiers.map((_, i) => i >= first),
          `"${row.label}" is not cumulative up the ladder`,
        );
      }
    }
  });

  it('shows exactly the bullets, once each, matching their tier', () => {
    const rows = comparisonGroups().flatMap((g) => g.rows);
    assert.equal(rows.length, totalBulletCount());

    for (const tier of TIER_IDS) {
      for (const bullet of TIER_BULLETS[tier]) {
        const row = rows.find((r) => r.label === bullet.label);
        if (!row) {
          assert.fail(`"${bullet.label}" is missing from the comparison table`);
        }
        assert.equal(
          TIER_IDS[row.tiers.indexOf(true)],
          minTierFor(bullet.feature),
          `"${bullet.label}" starts at the wrong column`,
        );
      }
    }
  });
});
