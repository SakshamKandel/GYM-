'use client';

/**
 * Pricing hero + the four tier cards — one client component so the NPR/USD
 * region toggle in the hero drives the live prices on every card below it.
 * Iron & Ember: aurora + gridlines behind, glass tier cards, cream Gold.
 */
import { useState } from 'react';
import type { PublicCatalog } from '@/lib/publicCatalog';
import { Reveal } from '../motion';
import {
  bulletsFor,
  inheritsFrom,
  priceFor,
  TIER_META,
  type Region,
  type TierId,
} from '../pricing-format';
import { CheckItem, Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

/**
 * Card copy only — the feature bullets come from TIER_BULLETS in
 * pricing-format.ts so this page, the home teaser and the comparison table
 * can never claim different things.
 */
const TIER_CTA: Record<TierId, string> = {
  starter: 'Start free',
  silver: 'Choose Silver',
  gold: 'Choose Gold',
  elite: 'Choose Elite',
};

export function PricingHero({ catalog }: { catalog: PublicCatalog }) {
  const [region, setRegion] = useState<Region>('NP');
  const regionCatalog = catalog[region];

  return (
    <Section
      tone="ink"
      ambient="aurora"
      grid
      pad="pt-[120px] pb-20 sm:pt-[140px] sm:pb-28"
    >
      <Container wide>
        {/* Centered short hero */}
        <div className="mx-auto max-w-3xl text-center">
          <Reveal delay={80}>
            <Display as="h1" size="xl" className="mt-6">
              <span className="mkt-text-steel">Simple,</span>
              <br />
              <span className="mkt-text-ember">regional</span>
              <br />
              <span className="mkt-text-steel">pricing.</span>
            </Display>
          </Reveal>
          <Reveal delay={160}>
            <Lead className="mx-auto mt-7">
              Set in NPR for Nepal and USD for everyone else. These are the exact live prices the
              app charges, from the same catalog. Start free. Add a coach when it gets
              serious.
            </Lead>
          </Reveal>
          <Reveal delay={240} className="mt-9 flex justify-center">
            <div role="group" aria-label="Price region" className="mkt-glass flex rounded-full p-1">
              {(
                [
                  ['NP', '🇳🇵 Nepal'],
                  ['INTL', 'International'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={region === key}
                  onClick={() => setRegion(key)}
                  className={`h-11 rounded-full px-6 text-[14.5px] font-semibold transition-colors ${
                    region === key ? 'bg-red text-ink shadow-ember' : 'text-dim hover:text-snow'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Reveal>
        </div>

        {/* Four detailed tier cards */}
        <div className="mt-16 grid gap-4 text-left sm:grid-cols-2 xl:grid-cols-4">
          {TIER_META.map((t, i) => {
            const highlight = t.tier === 'gold';
            const price = priceFor(regionCatalog, t.tier);
            const inherited = inheritsFrom(t.tier);
            return (
              <Reveal key={t.tier} delay={120 + i * 90} className="h-full">
                <div
                  className={`flex h-full flex-col rounded-block p-7 ${
                    highlight
                      ? 'bg-cream text-ink shadow-ember-lg'
                      : 'mkt-glass-deep mkt-card-hover text-snow'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-2xl font-medium uppercase">{t.name}</h2>
                    {highlight ? (
                      <span className="rounded-full bg-red px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
                        Popular
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="font-display text-[40px] font-medium leading-none">
                      {price}
                    </span>
                    {!['Free', 'Unavailable'].includes(price) ? (
                      <span
                        className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
                          highlight ? 'text-cream-dim' : 'text-faint'
                        }`}
                      >
                        / month
                      </span>
                    ) : null}
                  </div>

                  <p
                    className={`mt-3 text-[14.5px] leading-relaxed ${
                      highlight ? 'text-cream-dim' : 'text-dim'
                    }`}
                  >
                    {t.blurb}
                  </p>

                  <ul className="mt-6 flex flex-col gap-3">
                    {inherited ? (
                      <CheckItem tone={highlight ? 'light' : 'dark'}>{inherited}</CheckItem>
                    ) : null}
                    {bulletsFor(t.tier).map((bullet) => (
                      <CheckItem key={bullet.label} tone={highlight ? 'light' : 'dark'}>
                        {bullet.label}
                      </CheckItem>
                    ))}
                  </ul>

                  <div className="mt-auto pt-8">
                    {regionCatalog.available ? (
                      <PillLink
                        href="/download"
                        small
                        variant={highlight ? 'inkOnCream' : 'ghost'}
                        className="w-full"
                      >
                        {TIER_CTA[t.tier]}
                      </PillLink>
                    ) : (
                      <span role="status" className="block text-center text-sm font-semibold">
                        Pricing temporarily unavailable
                      </span>
                    )}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={200}>
          <p className="mt-12 text-center font-mono text-[12px] uppercase tracking-[0.16em] text-faint">
            Cancel or downgrade anytime · eSewa &amp; Khalti in Nepal · 30% off with a
            verified coach&rsquo;s code
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
