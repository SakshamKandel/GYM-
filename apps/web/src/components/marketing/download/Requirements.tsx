'use client';

/**
 * Requirements — a plain, honest spec sheet in mono. No hype: platforms,
 * language, pricing regions, account policy.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const SPECS = [
  ['Platforms', 'iOS 15+ · Android 9+'],
  ['Interface language', 'English'],
  ['Pricing regions', 'Nepal (NPR) · International (USD)'],
  ['Account', 'Optional — the tracker works signed out'],
  ['Connectivity', 'Offline-first, syncs when online'],
  ['Ads & data', 'No ads. We never sell your data.'],
] as const;

export function Requirements() {
  return (
    <Section tone="ink">
      <Container wide>
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <Reveal>
            <Eyebrow>The fine print</Eyebrow>
            <Display size="md" className="mt-4">
              What it runs on.
            </Display>
            <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-dim">
              Nothing exotic. If your phone is from the last few years, you&rsquo;re set —
              in Kathmandu or anywhere else.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mkt-glass-deep rounded-block p-8 sm:p-10">
              <dl>
                {SPECS.map(([term, value], i) => (
                  <div key={term}>
                    {i > 0 ? <div className="mkt-divider my-5" /> : null}
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                      <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
                        {term}
                      </dt>
                      <dd className="text-[15px] font-medium text-snow sm:text-right">{value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
