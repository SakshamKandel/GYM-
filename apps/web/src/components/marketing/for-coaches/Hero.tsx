'use client';

/**
 * /for-coaches hero v3 — dark cinematic opener: ember aurora + blueprint
 * grid over near-black, eyebrow pill, word-by-word headline reveal, magnetic
 * CTAs and the coach console's client roster floating in a BrowserFrame.
 * Product-truth proof band below.
 */
import { CountUp, Float, Magnetic, Reveal, WordStagger } from '../motion';
import { Container, PillLink } from '../ui';
import { CoachClientsMock } from './CoachClientsMock';

const PROOF = [
  { value: 30, suffix: '%', caption: 'commission on every client sub' },
  { value: 30, suffix: '%', caption: 'off for clients on your code' },
  { value: 3, suffix: '', caption: 'seniority tiers · silver to elite' },
  { value: 1, suffix: '', caption: 'auto promo code per verified coach' },
] as const;

export function CoachHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[128px] sm:pt-[150px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[0.92fr_1.08fr]">
          <div>

            <h1 className="mt-6 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
              <WordStagger text="Coach on" className="mkt-text-steel block" delay={120} />
              <WordStagger text="your own" className="mkt-text-steel block" delay={320} />
              <WordStagger text="terms." className="mkt-text-ember block" delay={520} />
            </h1>

            <Reveal delay={700}>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
                Bring your clients or find new ones. The GM Method gives verified coaches a
                public profile, a proper client console, and a promo code that pays — you do
                the coaching, the app does the admin.
              </p>
            </Reveal>

            <Reveal delay={820} className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic>
                <PillLink href="/download">Apply in the app</PillLink>
              </Magnetic>
              <Magnetic strength={0.22}>
                <PillLink href="/coach/login" variant="ghost">
                  Coach sign-in
                </PillLink>
              </Magnetic>
            </Reveal>

            <Reveal delay={920}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Verified by the GM team · Capacity-gated · Rs wallet payouts
              </p>
            </Reveal>
          </div>

          <Reveal delay={420} y={40} className="flex justify-center lg:justify-end">
            <Float amplitude={9} duration={7}>
              <CoachClientsMock className="w-full max-w-[620px]" />
            </Float>
          </Reveal>
        </div>

        {/* proof band */}
        <div className="mkt-divider mt-20" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-4">
          {PROOF.map((s, i) => (
            <Reveal key={s.caption} delay={i * 90}>
              <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
                <CountUp to={s.value} suffix={s.suffix} />
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
