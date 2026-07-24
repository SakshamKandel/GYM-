'use client';

/**
 * Home Pricing Teaser — Premium metal tier cards with regional Nepal / Global pricing switch,
 * feature checklists, eSewa/Khalti Nepal payment badges, and zero emojis.
 */
import { motion } from 'motion/react';
import { useState } from 'react';
import type { PublicCatalog } from '@/lib/publicCatalog';
import { Reveal, Stagger, StaggerItem } from '../motion';
import { priceFor, TIER_META, type Region } from '../pricing-format';
import { Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

const TIER_FEATURES: Record<string, string[]> = {
  starter: ['Gym Mode & Set Logger', '650+ Exercise Library', 'Basic EWMA Weight Trend', 'Offline SQLite Queue'],
  silver: ['Everything in Starter', 'Macro & Barcode Scanner', 'True-3D Muscle Anatomy', 'Gym Discovery Passes'],
  gold: ['Everything in Silver', '1-on-1 Coach Plan Sync', '15% Off Kathmandu Meals', 'Priority Support Inbox'],
  elite: ['Everything in Gold', 'Dedicated Senior Coach', 'Customized Diet Plans', 'VIP Event Passes'],
};

export function PricingTeaser({ catalog }: { catalog: PublicCatalog }) {
  const [region, setRegion] = useState<Region>('NP');
  const regionCatalog = catalog[region];

  return (
    <Section tone="paper-2" id="pricing" overflowHidden={false}>
      <Container wide>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <Reveal>
            <Eyebrow tone="light">Membership Tiers</Eyebrow>
            <Display className="mt-4">Start free. Level up when it&rsquo;s real.</Display>
            <Lead tone="light" className="mt-5">
              Transparent plans tailored for Nepal and international athletes — zero hidden fees.
            </Lead>
          </Reveal>

          {/* Region Toggle */}
          <Reveal delay={120}>
            <div
              role="group"
              aria-label="Price region"
              className="mkt-card-light flex rounded-full p-1.5 border border-line-strong/40 bg-white/80 shadow-sm"
            >
              {(
                [
                  ['NP', 'Nepal (NPR)'],
                  ['INTL', 'Global (USD)'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={region === key}
                  onClick={() => setRegion(key)}
                  className={`relative h-11 rounded-full px-6 text-[13.5px] font-semibold transition-colors ${
                    region === key ? 'text-snow' : 'text-gravel hover:text-ink'
                  }`}
                >
                  {region === key ? (
                    <motion.span
                      layoutId="pricing-region-pill"
                      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                      className="absolute inset-0 rounded-full bg-ink shadow-sm"
                    />
                  ) : null}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>
          </Reveal>
        </div>

        {/* 4 Metal Membership Cards */}
        <Stagger className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" gap={0.08}>
          {TIER_META.map((t) => {
            const isGold = t.tier === 'gold';
            const features = TIER_FEATURES[t.tier] ?? [];

            return (
              <StaggerItem key={t.tier}>
                <div
                  className={`relative flex flex-col justify-between rounded-[26px] p-7 transition-all duration-300 ${
                    isGold
                      ? 'bg-ink text-snow shadow-pop border-2 border-red scale-[1.02]'
                      : 'bg-white text-ink border border-line-strong/50 shadow-card hover:border-ink/30 hover:shadow-pop'
                  }`}
                >
                  {isGold ? (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-red px-4 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink shadow-ember">
                      Most Popular
                    </div>
                  ) : null}

                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-2xl font-bold uppercase tracking-tight">
                        {t.name}
                      </h3>
                      <span className={`font-mono text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                        isGold ? 'bg-red/20 text-red' : 'bg-paper-2 text-gravel'
                      }`}>
                        {t.tier}
                      </span>
                    </div>

                    <p className={`mt-3 text-[13.5px] leading-relaxed ${isGold ? 'text-dim' : 'text-gravel'}`}>
                      {t.blurb}
                    </p>

                    {/* Price Block */}
                    <div className="my-6 py-4 border-y border-line-strong/20">
                      <span className="font-display text-4xl font-extrabold tracking-tight">
                        {priceFor(regionCatalog, t.tier)}
                      </span>
                      {!['Free', 'Unavailable'].includes(priceFor(regionCatalog, t.tier)) ? (
                        <span className={`ml-2 font-mono text-[11.5px] uppercase tracking-wider ${isGold ? 'text-faint' : 'text-gravel'}`}>
                          / month
                        </span>
                      ) : null}
                    </div>

                    {/* Feature list */}
                    <ul className="flex flex-col gap-2.5">
                      {features.map((f) => (
                        <li key={f} className="flex items-center gap-2.5 text-[13px]">
                          <span className={`flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            isGold ? 'bg-red text-ink' : 'bg-ink text-snow'
                          }`}>
                            ✓
                          </span>
                          <span className={isGold ? 'text-snow' : 'text-ink'}>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8 pt-4">
                    {regionCatalog.available ? (
                      <PillLink
                        href={t.tier === 'starter' ? '/download' : '/pricing'}
                        variant={isGold ? 'red' : 'outline'}
                        className="w-full justify-center"
                      >
                        {t.tier === 'starter' ? 'Get Started Free' : 'Choose ' + t.name}
                      </PillLink>
                    ) : (
                      <span role="status" className="block text-center text-sm font-semibold">
                        Pricing temporarily unavailable
                      </span>
                    )}
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>

        {/* Nepal Payment Badges Footer */}
        <Reveal delay={200} className="mt-14 flex flex-wrap items-center justify-between gap-6 p-6 rounded-[20px] bg-white border border-line-strong/40 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[12px] uppercase tracking-wider text-gravel">
            <span className="font-bold text-ink">Supported Payment Options:</span>
            <span className="rounded-full bg-paper px-3 py-1 border border-line-strong font-sans font-semibold text-ink">
              eSewa Receipt Upload
            </span>
            <span className="rounded-full bg-paper px-3 py-1 border border-line-strong font-sans font-semibold text-ink">
              Khalti Instant
            </span>
            <span className="rounded-full bg-paper px-3 py-1 border border-line-strong font-sans font-semibold text-ink">
              Credit/Debit Cards
            </span>
          </div>

          <div className="flex items-center gap-4">
            <PillLink href="/pricing" variant="ghost" small className="text-ink hover:text-red">
              Compare all features →
            </PillLink>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
