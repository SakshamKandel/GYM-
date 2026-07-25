'use client';

/**
 * Feature comparison — the editorial cream counterpoint. A real table,
 * hairline cream-line rows, built from the one bullet map in pricing-format.ts
 * so every ✓ here matches what the app actually unlocks at that tier.
 */
import { Fragment } from 'react';
import { Reveal } from '../motion';
import { comparisonGroups, TIER_META, totalBulletCount } from '../pricing-format';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const GROUPS = comparisonGroups();

const TIER_COLS = TIER_META.map((t) => t.name);

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
          <Eyebrow tone="light">
            Compare · {totalBulletCount()} features · {TIER_COLS.length} tiers
          </Eyebrow>
          <Display className="mt-4 max-w-3xl">Every feature, by tier.</Display>
          <Lead tone="light" className="mt-5">
            Starter is free forever, with no time limit. Ordering partner meals and
            finding nearby gyms are open to everyone. The paid tiers add the parts
            software can&rsquo;t do alone: a real coach, and a plan that adapts to you.
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
                        <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim">
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
            Every tick on this table is checked by the app itself. The tier you pay for
            is the tier you get.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
