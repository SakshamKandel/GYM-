'use client';

/**
 * Coaching hero — aurora over near-black, blueprint grid, split layout with
 * the coach-discovery screen glowing in a tilted iPhone. Product-truth stat
 * band under a gradient divider.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { CoachDiscoveryScreen } from '../screens/CoachDiscoveryScreen';
import { Container, PillLink } from '../ui';

const STATS = [
  { value: '100%', caption: 'coaches admin-verified' },
  { value: '3', caption: 'seniority tiers · silver → elite' },
  { value: '1', caption: 'pending request at a time' },
  { value: '2-way', caption: 'PII masking in every chat' },
] as const;

export function CoachingHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal delay={80}>
              <h1 className="mt-6 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
                <span className="mkt-text-steel">Get coached.</span>
                <br />
                <span className="mkt-text-steel">By a </span>
                <span className="mkt-text-ember">human.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
                Browse admin-verified coaches with public track records, send one request,
                and get a real program — workouts, diet plans and chat inside the app you
                already train with. No spreadsheets, no WhatsApp threads.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-wrap items-center gap-4">
              <PillLink href="/download">Find your coach</PillLink>
              <PillLink href="/pricing" variant="ghost">
                See tiers &amp; pricing
              </PillLink>
            </Reveal>
            <Reveal delay={320}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Silver · Gold · Elite mentorship
              </p>
            </Reveal>
          </div>

          <Reveal delay={200} className="flex justify-center lg:justify-end lg:pr-10">
            <PhoneFrame tilt="right" scale={0.94} priority>
              <CoachDiscoveryScreen />
            </PhoneFrame>
          </Reveal>
        </div>

        {/* Product-truth stat band */}
        <div className="mkt-divider mt-24" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.caption} delay={i * 90}>
              <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
                {s.value}
              </div>
              <p className="mt-2.5 font-mono text-[11.5px] uppercase tracking-[0.16em] text-dim">
                {s.caption}
              </p>
            </Reveal>
          ))}
        </div>
      </Container>
    </div>
  );
}
