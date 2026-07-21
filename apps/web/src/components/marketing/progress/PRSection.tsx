'use client';

/**
 * PR deep-dive — ink band, copy left, the drawing PR timeline card right.
 */
import { Reveal } from '../motion';
import { PRTimelineCard } from '../screens/PRTimelineCard';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const FACTS = ['Detected on save', 'Celebrated in the moment', 'Kept on your timeline'] as const;

export function PRSection() {
  return (
    <Section tone="ink" grid>
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <Reveal>
              <Eyebrow>03 — Personal records</Eyebrow>
              <Display className="mt-4">
                PRs caught,
                <br />
                not claimed.
              </Display>
              <Lead className="mt-6">
                You just log the set. The app checks it against your entire lifting history
                the moment it saves — heaviest weight, best reps at a weight — and stamps a
                celebration when you beat it. The detection logic is unit-tested, so a PR
                never slips past unnoticed.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <div className="mt-8 flex flex-wrap gap-2.5">
                {FACTS.map((f) => (
                  <span
                    key={f}
                    className="mkt-glass rounded-full px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-dim"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </Reveal>
            <Reveal delay={220}>
              <p className="mt-8 max-w-md text-[14.5px] leading-relaxed text-dim">
                No manual &ldquo;mark as PR&rdquo; button to forget. If the bar moved further
                than it ever has, the app knew before you re-racked it.
              </p>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <PRTimelineCard />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
