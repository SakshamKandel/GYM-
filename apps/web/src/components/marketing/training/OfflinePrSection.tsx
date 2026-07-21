'use client';

/**
 * Offline-first & PR detection section — consumer-focused, zero developer jargon.
 */
import { Reveal, useStepLoop } from '../motion';
import { CheckItem, Container, Display, Lead, Section } from '../ui';

const STAGES = [
  { title: 'Logged Instantly', caption: 'Confirmed right away' },
  { title: 'Local Device Save', caption: 'Saved on your phone' },
  { title: 'Automatic Backup', caption: 'Syncs when online' },
  { title: 'Cloud Protection', caption: 'Kept safe & private' },
] as const;

function WritePathCard() {
  const [ref, step] = useStepLoop(6, 1000, 3);
  const lit = Math.min(step, STAGES.length - 1);

  return (
    <div ref={ref} className="rounded-block bg-ink p-7 shadow-pop sm:p-8">
      <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-dim">
        Instant Workout Saver
      </p>
      <div className="mt-6 flex flex-col">
        {STAGES.map((s, i) => {
          const on = i <= lit;
          return (
            <div key={s.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 ${
                    on ? 'scale-100 bg-red text-ink' : 'scale-90 bg-charcoal-2 text-faint'
                  }`}
                >
                  {on ? '✓' : ''}
                </span>
                {i < STAGES.length - 1 ? (
                  <span
                    className={`w-[2px] flex-1 rounded-full transition-colors duration-300 ${
                      i < lit ? 'bg-red' : 'bg-charcoal-2'
                    }`}
                  />
                ) : null}
              </div>
              <div className="pb-6">
                <p
                  className={`text-[15px] font-semibold leading-7 transition-colors duration-300 ${
                    on ? 'text-snow' : 'text-faint'
                  }`}
                >
                  {s.title}
                </p>
                <p className="text-[12px] text-dim">
                  {s.caption}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mkt-divider" />
      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-[13px] leading-relaxed text-dim">
          Personal Record (PR) detection highlights your biggest milestones in real time.
        </p>
        <span className="shrink-0 rounded-full bg-red px-3.5 py-1.5 font-display text-[13px] font-medium text-ink">
          80 KG × 5
        </span>
      </div>
    </div>
  );
}

export function OfflinePrSection() {
  return (
    <Section tone="red">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <Display className="text-ink">
                PRs don&rsquo;t wait
                <br />
                for signal.
              </Display>
              <Lead tone="red" className="mt-6">
                Basement gym, dead zone, airplane mode — doesn&rsquo;t matter. Every
                set is saved on your phone instantly and syncs to the cloud whenever
                you have signal. You never wait on a loading spinner.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-9 flex flex-col gap-3.5">
                <CheckItem tone="red">
                  Every set is logged instantly on your phone with zero delay
                </CheckItem>
                <CheckItem tone="red">
                  Automatic background sync saves your workout history securely
                </CheckItem>
                <CheckItem tone="red">
                  Instant PR detection celebrates personal records the second you finish a set
                </CheckItem>
                <CheckItem tone="red">
                  Your workout history stays accessible on your phone anytime, offline
                </CheckItem>
              </ul>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <WritePathCard />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
