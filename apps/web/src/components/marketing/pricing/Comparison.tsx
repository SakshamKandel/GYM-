'use client';

/**
 * Feature comparison — the editorial cream counterpoint. A real table,
 * hairline cream-line rows, grouped by how people actually think about the
 * app: self-coached first, marketplace second, human coaching last.
 */
import { Fragment } from 'react';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

interface FeatureRow {
  label: string;
  /** [starter, silver, gold, elite] */
  tiers: [boolean, boolean, boolean, boolean];
}

interface FeatureGroup {
  group: string;
  rows: FeatureRow[];
}

const GROUPS: FeatureGroup[] = [
  {
    group: 'Self-coached training',
    rows: [
      { label: 'Offline workout logging + gym mode', tiers: [true, true, true, true] },
      { label: 'Food diary + barcode scan', tiers: [true, true, true, true] },
      { label: 'True-3D anatomy — 17 muscle zones', tiers: [true, true, true, true] },
      { label: 'Automatic PR detection + streaks', tiers: [true, true, true, true] },
      { label: 'Weight trend smoothing + measurements', tiers: [true, true, true, true] },
    ],
  },
  {
    group: 'Marketplace',
    rows: [
      { label: 'Partner meal ordering — Kathmandu Valley', tiers: [true, true, true, true] },
      { label: 'Nearby gym discovery', tiers: [true, true, true, true] },
      {
        label: 'Member discount card at partner restaurants',
        tiers: [false, true, true, true],
      },
    ],
  },
  {
    group: 'Human coaching',
    rows: [
      { label: 'Coach-assigned workouts', tiers: [false, true, true, true] },
      { label: 'Personal diet plan', tiers: [false, false, true, true] },
      { label: 'Any-time coach chat', tiers: [false, false, false, true] },
      { label: 'Full mentorship + coach-logged milestones', tiers: [false, false, false, true] },
      { label: 'Priority support', tiers: [false, false, false, true] },
    ],
  },
];

const TIER_COLS = ['Starter', 'Silver', 'Gold', 'Elite'] as const;

function Cell({ included, tier }: { included: boolean; tier: string }) {
  return (
    <td className={`px-2 py-4 text-center ${tier === 'Gold' ? 'bg-ink/5' : ''}`}>
      {included ? (
        <>
          <span
            aria-hidden
            className="mx-auto flex size-[22px] items-center justify-center rounded-full bg-ink text-[11px] font-bold text-cream"
          >
            ✓
          </span>
          <span className="sr-only">Included</span>
        </>
      ) : (
        <>
          <span aria-hidden className="text-[15px] text-cream-dim">
            —
          </span>
          <span className="sr-only">Not included</span>
        </>
      )}
    </td>
  );
}

export function Comparison() {
  return (
    <Section tone="cream">
      <Container wide>
        <Reveal>
          <Eyebrow tone="light">Compare — 13 features · 4 tiers</Eyebrow>
          <Display className="mt-4 max-w-3xl">Every feature, by tier.</Display>
          <Lead tone="light" className="mt-5">
            Starter is the full self-tracking app — nothing crippled, no timer. The paid
            tiers only add what software can&rsquo;t do: a real human coach.
          </Lead>
        </Reveal>

        <Reveal delay={140} className="mt-14">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-ink/80">
                  <th scope="col" className="w-[38%] pb-4 pr-6">
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream-dim">
                      Feature
                    </span>
                  </th>
                  {TIER_COLS.map((tier) => (
                    <th
                      scope="col"
                      key={tier}
                      className={`w-[14%] px-2 pb-4 text-center ${
                        tier === 'Gold' ? 'bg-ink/5' : ''
                      }`}
                    >
                      <span className="font-display text-[17px] font-medium uppercase tracking-[0.06em] text-ink">
                        {tier}
                      </span>
                      {tier === 'Gold' ? (
                        <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.18em] text-cream-dim">
                          Popular
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => (
                  <Fragment key={g.group}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="pb-3 pt-8 text-left font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-cream-dim"
                      >
                        {g.group}
                      </th>
                    </tr>
                    {g.rows.map((row) => (
                      <tr key={row.label} className="border-b border-cream-line">
                        <th
                          scope="row"
                          className="py-4 pr-6 text-[14.5px] font-medium leading-snug text-ink"
                        >
                          {row.label}
                        </th>
                        {row.tiers.map((included, i) => (
                          <Cell key={TIER_COLS[i]} included={included} tier={TIER_COLS[i]} />
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal delay={220}>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-cream-dim">
            Entitlements are checked server-side — what you see here is what the app
            enforces.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
