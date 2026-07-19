import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';
import type { MaterializationSub, OrderActor } from './orders.ts';

// orders.ts imports a sibling helper (./meals) without an extension — the
// repo-wide source idiom (see activity.test.ts / progression.test.ts). Bridge
// relative specifiers to their .ts files for this test process only, then load
// the module under test dynamically AFTER the hook is registered.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const {
  ORDER_STATUSES,
  actorsFor,
  buildMaterializationPlan,
  canActorAdvance,
  canAdvance,
  canAdvanceCycle,
  canAdvanceSubscription,
  isTerminalOrderStatus,
  cyclePaymentMutationBlock,
  mergePaymentMutationBlocks,
  orderPaymentMutationBlock,
  partnerRotationFor,
  repriceCycleForNewSkip,
  subscriptionActionTarget,
  weekBoundsFor,
  memberCancelability,
  partnerRefusableFrom,
  partnerCanRefuse,
  partnerRefuseTarget,
  orderNumber,
} = await import('./orders.ts');

function ktm(y: number, mo: number, da: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, mo - 1, da, hh, mm) - 345 * 60_000);
}

describe('canAdvance — structural order machine (§8)', () => {
  it('matches the frozen transition table', () => {
    assert.deepEqual(
      ORDER_STATUSES.map((from) => ORDER_STATUSES.filter((to) => canAdvance(from, to))),
      [
        ['confirmed', 'cancelled'], // pending
        ['preparing', 'cancelled'], // confirmed
        ['out_for_delivery', 'cancelled'], // preparing
        ['delivered', 'refused'], // out_for_delivery
        [], // delivered
        [], // cancelled
        [], // refused
      ],
    );
  });
  it('terminal states have no outbound transitions', () => {
    for (const s of ['delivered', 'cancelled', 'refused'] as const) {
      assert.equal(isTerminalOrderStatus(s), true);
      for (const to of ORDER_STATUSES) assert.equal(canAdvance(s, to), false);
    }
  });
  it('rejects skips and self-loops', () => {
    assert.equal(canAdvance('pending', 'preparing'), false);
    assert.equal(canAdvance('pending', 'delivered'), false);
    assert.equal(canAdvance('confirmed', 'confirmed'), false);
  });
});

describe('canActorAdvance — who may set what (§3)', () => {
  it('member may only cancel a pending order', () => {
    assert.equal(canActorAdvance('pending', 'cancelled', 'member'), true);
    assert.equal(canActorAdvance('pending', 'confirmed', 'member'), false);
    assert.equal(canActorAdvance('confirmed', 'cancelled', 'member'), false);
    assert.equal(canActorAdvance('out_for_delivery', 'cancelled', 'member'), false);
  });
  it('partner drives the normal fulfillment path', () => {
    assert.equal(canActorAdvance('pending', 'confirmed', 'partner'), true);
    assert.equal(canActorAdvance('confirmed', 'preparing', 'partner'), true);
    assert.equal(canActorAdvance('preparing', 'out_for_delivery', 'partner'), true);
    assert.equal(canActorAdvance('out_for_delivery', 'delivered', 'partner'), true);
    assert.equal(canActorAdvance('out_for_delivery', 'refused', 'partner'), true);
  });
  it('partner may NOT cancel a preparing order (admin-only override)', () => {
    assert.equal(canActorAdvance('preparing', 'cancelled', 'partner'), false);
    assert.equal(canActorAdvance('preparing', 'cancelled', 'admin'), true);
  });
  it('admin may cancel ANY non-terminal order, including out_for_delivery', () => {
    for (const from of ['pending', 'confirmed', 'preparing', 'out_for_delivery'] as const) {
      assert.equal(canActorAdvance(from, 'cancelled', 'admin'), true);
    }
  });
  it('admin cannot cancel a terminal order', () => {
    for (const from of ['delivered', 'cancelled', 'refused'] as const) {
      assert.equal(canActorAdvance(from, 'cancelled', 'admin'), false);
    }
  });
  it('no actor may perform an illegal structural transition', () => {
    for (const actor of ['member', 'partner', 'admin'] as OrderActor[]) {
      assert.equal(canActorAdvance('pending', 'delivered', actor), false);
    }
  });
  it('actorsFor lists the explicit actors for a legal transition', () => {
    assert.deepEqual([...actorsFor('pending', 'cancelled')], ['member', 'partner', 'admin']);
    assert.deepEqual([...actorsFor('confirmed', 'cancelled')], ['partner', 'admin']);
    assert.deepEqual([...actorsFor('pending', 'preparing')], []);
  });
});

describe('memberCancelability — payment-aware cancel gate (B1)', () => {
  const cutoff = ktm(2026, 7, 19, 10, 0);
  const beforeCutoff = ktm(2026, 7, 19, 6, 0);
  const afterCutoff = ktm(2026, 7, 19, 11, 0);

  it('allows cancel of a pending, unpaid, pre-cutoff order', () => {
    assert.deepEqual(
      memberCancelability({ status: 'pending', paymentStatus: 'unpaid', cutoffAt: cutoff }, beforeCutoff),
      { allowed: true },
    );
  });
  it('blocks a receipt-in-review order (server would 409)', () => {
    assert.deepEqual(
      memberCancelability(
        { status: 'pending', paymentStatus: 'receipt_submitted', cutoffAt: cutoff },
        beforeCutoff,
      ),
      { allowed: false, blocked: 'payment_review_required' },
    );
  });
  it('blocks a paid order → refund path', () => {
    assert.deepEqual(
      memberCancelability({ status: 'pending', paymentStatus: 'paid', cutoffAt: cutoff }, beforeCutoff),
      { allowed: false, blocked: 'refund_required' },
    );
  });
  it('money-in-flight takes precedence over a passed cutoff', () => {
    assert.deepEqual(
      memberCancelability({ status: 'pending', paymentStatus: 'paid', cutoffAt: cutoff }, afterCutoff),
      { allowed: false, blocked: 'refund_required' },
    );
  });
  it('blocks past cutoff when no money is in flight', () => {
    assert.deepEqual(
      memberCancelability({ status: 'pending', paymentStatus: 'unpaid', cutoffAt: cutoff }, afterCutoff),
      { allowed: false, blocked: 'past_cutoff' },
    );
  });
  it('non-pending statuses are not member-cancelable (no reason — affordance hides)', () => {
    for (const status of ['confirmed', 'preparing', 'out_for_delivery', 'delivered'] as const) {
      assert.deepEqual(
        memberCancelability({ status, paymentStatus: 'unpaid', cutoffAt: cutoff }, beforeCutoff),
        { allowed: false },
      );
    }
  });
});

describe('partner refuse (B6/B7)', () => {
  it('is refusable from every pre-delivery stage', () => {
    for (const s of ['pending', 'confirmed', 'preparing', 'out_for_delivery'] as const) {
      assert.equal(partnerCanRefuse(s), true);
      assert.equal(partnerRefusableFrom.has(s), true);
    }
  });
  it('is not refusable from a terminal stage', () => {
    for (const s of ['delivered', 'cancelled', 'refused'] as const) {
      assert.equal(partnerCanRefuse(s), false);
      assert.equal(partnerRefuseTarget(s), null);
    }
  });
  it('at-the-door refusal → refused; earlier stages → cancelled', () => {
    assert.equal(partnerRefuseTarget('out_for_delivery'), 'refused');
    assert.equal(partnerRefuseTarget('pending'), 'cancelled');
    assert.equal(partnerRefuseTarget('confirmed'), 'cancelled');
    assert.equal(partnerRefuseTarget('preparing'), 'cancelled');
  });
});

describe('orderNumber', () => {
  it('is deterministic for a given id and GM-prefixed 8-char base32', () => {
    const id = '11111111-2222-3333-4444-abcdef012345';
    const a = orderNumber(id);
    const b = orderNumber(id);
    assert.equal(a, b);
    assert.match(a, /^GM-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
  it('differs for different ids', () => {
    assert.notEqual(
      orderNumber('00000000-0000-0000-0000-000000000001'),
      orderNumber('00000000-0000-0000-0000-000000000002'),
    );
  });
  it('does not crash on an empty / non-hex id', () => {
    assert.match(orderNumber(''), /^GM-0{8}$/);
  });
});

describe('subscription machine', () => {
  it('active ↔ paused, both → cancelled, cancelled terminal', () => {
    assert.equal(canAdvanceSubscription('active', 'paused'), true);
    assert.equal(canAdvanceSubscription('paused', 'active'), true);
    assert.equal(canAdvanceSubscription('active', 'cancelled'), true);
    assert.equal(canAdvanceSubscription('paused', 'cancelled'), true);
    assert.equal(canAdvanceSubscription('cancelled', 'active'), false);
    assert.equal(canAdvanceSubscription('active', 'active'), false);
  });
  it('maps member actions to target statuses', () => {
    assert.equal(subscriptionActionTarget('pause'), 'paused');
    assert.equal(subscriptionActionTarget('resume'), 'active');
    assert.equal(subscriptionActionTarget('cancel'), 'cancelled');
  });
});

describe('cycle machine', () => {
  it('open → awaiting_payment → paid; open/awaiting_payment → void', () => {
    assert.equal(canAdvanceCycle('open', 'awaiting_payment'), true);
    assert.equal(canAdvanceCycle('awaiting_payment', 'paid'), true);
    assert.equal(canAdvanceCycle('open', 'void'), true);
    assert.equal(canAdvanceCycle('awaiting_payment', 'void'), true);
    assert.equal(canAdvanceCycle('open', 'paid'), false);
    assert.equal(canAdvanceCycle('paid', 'void'), false);
  });
  it('awaiting_payment → receipt_submitted → paid; reject returns to awaiting_payment', () => {
    assert.equal(canAdvanceCycle('awaiting_payment', 'receipt_submitted'), true);
    assert.equal(canAdvanceCycle('receipt_submitted', 'paid'), true);
    assert.equal(canAdvanceCycle('receipt_submitted', 'awaiting_payment'), true);
    assert.equal(canAdvanceCycle('receipt_submitted', 'void'), true);
    assert.equal(canAdvanceCycle('open', 'receipt_submitted'), false);
  });
  it('a receipt_submitted cycle is money-in-review (blocks ordinary mutation)', () => {
    assert.equal(cyclePaymentMutationBlock('receipt_submitted'), 'payment_review_required');
  });
});

describe('payment-safe cancellation policy', () => {
  it('allows ordinary fulfilment mutations only when no money is in flight', () => {
    assert.equal(orderPaymentMutationBlock('unpaid'), null);
    assert.equal(orderPaymentMutationBlock('refunded'), null);
    assert.equal(orderPaymentMutationBlock('receipt_submitted'), 'payment_review_required');
    assert.equal(orderPaymentMutationBlock('paid'), 'refund_required');
  });

  it('protects prepaid cycles with pending or approved receipts', () => {
    assert.equal(cyclePaymentMutationBlock('open'), null);
    assert.equal(cyclePaymentMutationBlock('awaiting_payment'), null);
    assert.equal(
      cyclePaymentMutationBlock('awaiting_payment', ['pending']),
      'payment_review_required',
    );
    assert.equal(
      cyclePaymentMutationBlock('awaiting_payment', ['approved']),
      'refund_required',
    );
    assert.equal(cyclePaymentMutationBlock('paid'), 'refund_required');
    assert.equal(cyclePaymentMutationBlock('void', ['rejected', 'refunded']), null);
  });

  it('gives a captured payment precedence over another pending receipt', () => {
    assert.equal(
      mergePaymentMutationBlocks([
        null,
        'payment_review_required',
        'refund_required',
      ]),
      'refund_required',
    );
    assert.equal(mergePaymentMutationBlocks([null, 'payment_review_required']), 'payment_review_required');
    assert.equal(mergePaymentMutationBlocks([null, null]), null);
  });
});

describe('unfunded cycle repricing after a skip', () => {
  const awaiting = {
    status: 'awaiting_payment' as const,
    plannedSlots: 4,
    pricePerDayMinor: 25_000,
    amountMinor: 100_000,
  };

  it('decrements exactly once and recomputes the authoritative amount', () => {
    assert.deepEqual(repriceCycleForNewSkip(awaiting, true), {
      ...awaiting,
      plannedSlots: 3,
      amountMinor: 75_000,
    });
    assert.deepEqual(repriceCycleForNewSkip(awaiting, false), awaiting);
  });

  it('voids a cycle when its final planned slot is skipped', () => {
    assert.deepEqual(
      repriceCycleForNewSkip(
        { ...awaiting, plannedSlots: 1, amountMinor: 25_000 },
        true,
      ),
      {
        ...awaiting,
        status: 'void',
        plannedSlots: 0,
        amountMinor: 0,
      },
    );
  });

  it('never mutates paid, void, or duplicate cycles', () => {
    assert.deepEqual(
      repriceCycleForNewSkip({ ...awaiting, status: 'paid' }, true),
      { ...awaiting, status: 'paid' },
    );
    assert.deepEqual(
      repriceCycleForNewSkip({ ...awaiting, status: 'void' }, true),
      { ...awaiting, status: 'void' },
    );
  });
});

describe('partnerRotationFor', () => {
  const rotation = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
  it('is deterministic for a given (date, window)', () => {
    const a = partnerRotationFor(rotation, '2026-07-18', 'dinner');
    const b = partnerRotationFor(rotation, '2026-07-18', 'dinner');
    assert.equal(a, b);
    assert.ok(rotation.some((m) => m.id === a));
  });
  it('varies across consecutive days (rotates)', () => {
    const d0 = partnerRotationFor(rotation, '2026-07-18', 'lunch');
    const d1 = partnerRotationFor(rotation, '2026-07-19', 'lunch');
    // 3-item rotation over consecutive days advances by 2 (seed = day*2) → differ.
    assert.notEqual(d0, d1);
  });
  it('lunch and dinner of the same day can differ', () => {
    const l = partnerRotationFor(rotation, '2026-07-18', 'lunch');
    const dn = partnerRotationFor(rotation, '2026-07-18', 'dinner');
    assert.notEqual(l, dn);
  });
  it('throws on an empty rotation', () => {
    assert.throws(() => partnerRotationFor([], '2026-07-18', 'lunch'));
  });
});

describe('buildMaterializationPlan', () => {
  const now = ktm(2026, 7, 18, 6, 0); // Sat 06:00 KTM
  const horizon = { today: '2026-07-18', tomorrow: '2026-07-19' }; // Sat(6), Sun(0)
  const base = {
    partnerId: 'p1',
    accountId: 'a1',
    addressId: 'addr1',
    pricePerDayMinor: 25000,
    currency: 'NPR' as const,
    startDate: '2026-07-01',
    status: 'active' as const,
    skipDates: [] as string[],
  };

  it('plans one slot per subscribed, in-horizon, pre-cutoff day', () => {
    const sub: MaterializationSub = {
      ...base,
      id: 's1',
      daysOfWeek: [6, 0],
      window: 'dinner',
      planType: 'fixed_meal',
      mealId: 'm1',
    };
    const plan = buildMaterializationPlan([sub], horizon, now);
    assert.deepEqual(
      plan.map((p) => ({ date: p.deliveryDate, meal: p.mealId })),
      [
        { date: '2026-07-18', meal: 'm1' },
        { date: '2026-07-19', meal: 'm1' },
      ],
    );
    // cutoffAt is frozen to the slot cutoff.
    assert.equal(plan[0].cutoffAt.getTime(), ktm(2026, 7, 18, 10, 0).getTime());
  });

  it('excludes a slot whose cutoff has passed', () => {
    // lunch today (07-18) cutoff was 07-17 21:00 — already gone at 06:00 on 07-18.
    const sub: MaterializationSub = {
      ...base,
      id: 's2',
      daysOfWeek: [6, 0],
      window: 'lunch',
      planType: 'fixed_meal',
      mealId: 'm1',
    };
    const plan = buildMaterializationPlan([sub], horizon, now);
    assert.deepEqual(
      plan.map((p) => p.deliveryDate),
      ['2026-07-19'], // only tomorrow's lunch (cutoff 07-18 21:00) survives
    );
  });

  it('excludes unsubscribed weekdays, skips, paused subs, and pre-start dates', () => {
    const subs: MaterializationSub[] = [
      { ...base, id: 'paused', daysOfWeek: [6], window: 'dinner', planType: 'fixed_meal', mealId: 'm1', status: 'paused' },
      { ...base, id: 'skip', daysOfWeek: [0], window: 'dinner', planType: 'fixed_meal', mealId: 'm1', skipDates: ['2026-07-19'] },
      { ...base, id: 'future', daysOfWeek: [6, 0], window: 'dinner', planType: 'fixed_meal', mealId: 'm1', startDate: '2026-07-20' },
      { ...base, id: 'wrongday', daysOfWeek: [3], window: 'dinner', planType: 'fixed_meal', mealId: 'm1' },
    ];
    assert.deepEqual(buildMaterializationPlan(subs, horizon, now), []);
  });

  it('resolves a rotating plan deterministically', () => {
    const sub: MaterializationSub = {
      ...base,
      id: 'rot',
      daysOfWeek: [6],
      window: 'dinner',
      planType: 'partner_rotating',
      mealId: null,
      rotationMeals: [{ id: 'r1' }, { id: 'r2' }],
    };
    const plan = buildMaterializationPlan([sub], horizon, now);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].mealId, partnerRotationFor([{ id: 'r1' }, { id: 'r2' }], '2026-07-18', 'dinner'));
  });

  it('skips a rotating plan with no rotation meals (no crash)', () => {
    const sub: MaterializationSub = {
      ...base,
      id: 'emptyrot',
      daysOfWeek: [6],
      window: 'dinner',
      planType: 'partner_rotating',
      mealId: null,
      rotationMeals: [],
    };
    assert.deepEqual(buildMaterializationPlan([sub], horizon, now), []);
  });
});

describe('weekBoundsFor', () => {
  it('returns the Sun–Sat KTM week containing the date', () => {
    // 2026-07-18 is a Saturday → week is 2026-07-12 (Sun) … 2026-07-18 (Sat).
    assert.deepEqual(weekBoundsFor('2026-07-18'), {
      weekStart: '2026-07-12',
      weekEnd: '2026-07-18',
    });
    // 2026-07-19 is a Sunday → its own week start.
    assert.deepEqual(weekBoundsFor('2026-07-19'), {
      weekStart: '2026-07-19',
      weekEnd: '2026-07-25',
    });
  });
});
