'use client';

/**
 * /progress hero — aurora + blueprint grid over near-black, gradient display
 * type, the live streak screen in a tilted iPhone bathed in red light.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { StreakCalendarScreen } from '../screens/StreakCalendarScreen';
import { Container, PillLink } from '../ui';

export function ProgressHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pb-10 pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal delay={80}>
              <h1 className="mt-6 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
                <span className="mkt-text-steel">Slow mirror.</span>
                <br />
                <span className="mkt-text-steel">Noisy scale.</span>
                <br />
                <span className="mkt-text-steel">True </span>
                <span className="mkt-text-ember">trend.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
                Daily weigh-ins smoothed into a trend you can believe, tape measurements with
                deltas, PRs detected the moment you log the set, and streaks that make showing
                up visible. Proof, from every angle.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-wrap items-center gap-4">
              <PillLink href="/download">Get the app</PillLink>
              <PillLink href="/pricing" variant="ghost">
                See pricing
              </PillLink>
            </Reveal>
            <Reveal delay={320}>
              <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Weight · Tape · PRs · Streaks · Photos
              </p>
            </Reveal>
          </div>

          <Reveal delay={200} className="flex justify-center lg:justify-end lg:pr-10">
            <PhoneFrame tilt="right" scale={0.92} priority>
              <StreakCalendarScreen />
            </PhoneFrame>
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
