'use client';

/**
 * Map section (ink + blueprint grid) — the stylised street-map card with
 * sequenced red pins carries the page's accent. Copy is about picking a gym
 * you can actually reach: near home, near work, sorted by distance.
 */
import { Reveal } from '../motion';
import { GymMapCard } from '../screens/GymMapCard';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const CHIPS = ['Sorted by distance', 'Open-now status', 'One-tap directions'] as const;

export function MapSection() {
  return (
    <Section tone="ink" grid>
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <Reveal>
              <Eyebrow>02 — The map</Eyebrow>
              <Display flavor="steel" className="mt-4">
                Near home.
                <br />
                Near work.
                <br />
                Near done.
              </Display>
              <Lead className="mt-6">
                The best gym is the one you can actually reach. Listings sort by distance
                from where you are, show what&rsquo;s open right now, and hand the pin
                straight to your maps app — so the decision takes a minute, not a week.
              </Lead>
            </Reveal>
            <Reveal delay={140} className="mt-8 flex flex-wrap gap-2.5">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="mkt-glass inline-flex h-10 items-center rounded-full px-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-dim"
                >
                  {chip}
                </span>
              ))}
            </Reveal>
          </div>
          <Reveal delay={120}>
            <GymMapCard />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
