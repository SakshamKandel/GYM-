'use client';

/**
 * /training hero v3 — dark cinematic opener: ember aurora over near-black,
 * blueprint grid, word-by-word headline reveal, magnetic CTAs, and the
 * workout logger floating in red light. A product-truth stat band rides the
 * bottom of the same band, separated by a gradient divider.
 */
import { PhoneFrame } from '../PhoneFrame';
import { CountUp, Float, Magnetic, Reveal, WordStagger } from '../motion';
import { WorkoutLoggerScreen } from '../screens/WorkoutLoggerScreen';
import { Container, Lead, PillLink } from '../ui';

export function TrainingHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[128px] sm:pt-[150px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="mt-2 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
              <WordStagger text="The fastest" className="mkt-text-steel block" />
              <WordStagger text="logbook" className="mkt-text-steel block" />
              <WordStagger text="in the gym." className="mkt-text-ember block" />
            </h1>

            <Reveal delay={700}>
              <Lead tone="dark" className="mt-7">
                Coach-built plans, a gym mode that flows set to set, and an instant logger —
                offline, mid-set, chalk on your hands. When the PR lands, the app already knows.
              </Lead>
            </Reveal>

            <Reveal delay={820} className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic>
                <PillLink href="/download">Get the app</PillLink>
              </Magnetic>
              <Magnetic strength={0.22}>
                <PillLink href="/pricing" variant="ghost">
                  See pricing
                </PillLink>
              </Magnetic>
            </Reveal>

            <Reveal delay={920}>
              <p className="mt-8 font-sans text-[13px] text-faint">
                650+ exercises · Works fully offline
              </p>
            </Reveal>
          </div>

          <Reveal delay={420} y={40} className="flex justify-center lg:justify-end lg:pr-8">
            <Float amplitude={10} duration={7}>
              <PhoneFrame tilt="left" scale={0.94} priority>
                <WorkoutLoggerScreen />
              </PhoneFrame>
            </Float>
          </Reveal>
        </div>

        {/* Proof band */}
        <div className="mkt-divider mt-24" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-4">
          <Reveal>
            <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
              <CountUp to={650} suffix="+" />
            </div>
            <p className="mt-2.5 font-sans text-[13px] text-dim">
              exercises in the library
            </p>
          </Reveal>
          <Reveal delay={90}>
            <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
              Instant
            </div>
            <p className="mt-2.5 font-sans text-[13px] text-dim">
              workout logging speed
            </p>
          </Reveal>
          <Reveal delay={180}>
            <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
              <CountUp to={17} />
            </div>
            <p className="mt-2.5 font-mono text-[11.5px] uppercase tracking-[0.16em] text-dim">
              heat-mapped muscle zones
            </p>
          </Reveal>
          <Reveal delay={270}>
            <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">0</div>
            <p className="mt-2.5 font-mono text-[11.5px] uppercase tracking-[0.16em] text-dim">
              bars of signal needed
            </p>
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
