'use client';

/**
 * Story — the why, in two columns of prose on ink. Plain and a little dry.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

export function AboutStory() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Why we built it</Eyebrow>
          <Display size="lg" className="mt-4 max-w-3xl">
            The method is<br />
            the <span className="mkt-text-ember">whole point.</span>
          </Display>
        </Reveal>

        <div className="mt-14 grid gap-x-16 gap-y-8 md:grid-cols-2">
          <Reveal delay={100}>
            <div className="space-y-5 text-[16px] leading-relaxed text-dim">
              <p>
                Most people trying to get fit end up running a workout app, a calorie app, a
                delivery app and a coach on WhatsApp — four disconnected tabs and a lot of
                copy-paste. Nothing talks to anything else, and the friction is where progress
                quietly dies.
              </p>
              <p>
                We started as coaches in Kathmandu who kept rebuilding the same spreadsheets for
                every client. Then we brought engineers in to do it properly. The idea never
                changed: train with a plan, track what actually matters, and keep going long
                enough for it to work.
              </p>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="space-y-5 text-[16px] leading-relaxed text-dim">
              <p>
                So The GM Method folds all of it into one app. Workouts, food, weight, meal
                delivery, verified gyms and real human coaching — one home screen, one login you
                don&rsquo;t even need to create.
              </p>
              <p>
                It&rsquo;s offline-first because the gyms we train in have bad signal. It&rsquo;s
                unit-tested because the numbers should be true. And it&rsquo;s priced for Nepal
                first, then the rest of the world — not the other way around.
              </p>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
