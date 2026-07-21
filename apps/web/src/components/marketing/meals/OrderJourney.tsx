'use client';

/**
 * The 7-state order machine as a full-width animated diagram on paper — a
 * rail of nodes lighting in sequence (horizontal on desktop, vertical on
 * mobile). Deliberately NOT a phone: the same states, drawn in the site's
 * language. Faint blueprint grid keeps the "machine" feel on paper.
 */
import { Reveal, useStepLoop } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const STEPS = [
  { label: 'Placed', who: 'You', blurb: 'In before the kitchen cutoff.' },
  { label: 'Confirmed', who: 'Kitchen', blurb: 'The kitchen accepts your order.' },
  { label: 'Preparing', who: 'Kitchen', blurb: 'Cooked and portioned to the recipe.' },
  { label: 'Ready', who: 'Kitchen', blurb: 'Packed, labelled, awaiting pickup.' },
  { label: 'Picked up', who: 'Rider', blurb: 'With the rider, timestamped.' },
  { label: 'Out for delivery', who: 'Rider', blurb: 'Crossing the valley to you.' },
  { label: 'Delivered', who: 'You', blurb: 'COD settles. The diary logs itself.' },
] as const;

const FACTS = [
  'Cutoffs on Kathmandu time · UTC+05:45',
  'COD reconciles on delivery',
  'Prepaid cycles run digital · eSewa + Khalti',
] as const;

function StepNode({ i, done, active }: { i: number; done: boolean; active: boolean }) {
  return (
    <span
      className={`z-10 mx-1.5 flex size-9 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-medium transition-all duration-500 ${
        done
          ? 'bg-red text-ink'
          : active
            ? 'scale-110 bg-red text-ink shadow-ember'
            : 'border border-mist-strong bg-white text-gravel-faint'
      }`}
    >
      {done ? '✓' : i + 1}
    </span>
  );
}

export function OrderJourney() {
  // Steps 0–6 walk the machine; 7–8 rest on Delivered before looping.
  const [ref, raw] = useStepLoop(9, 1200, 6);
  const current = Math.min(raw, STEPS.length - 1);

  return (
    <Section tone="paper" grid>
      <Container wide>
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow tone="light">How ordering works</Eyebrow>
          <Display size="lg" className="mt-4">
            Seven states, <span className="text-red-deep">live.</span>
          </Display>
          <Lead tone="light" className="mx-auto mt-6">
            From the moment you order, every hand-off is a state in the app. The kitchen,
            the rider and you all watch the same truth move across the valley.
          </Lead>
        </Reveal>

        <Reveal delay={140}>
          <div ref={ref} className="mt-16">
            {/* Live readout */}
            <div className="mb-12 flex justify-center">
              <span className="mkt-card-light inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ink">
                <span className="size-1.5 animate-pulse rounded-full bg-red shadow-ember" />
                Order #GM-3057 — {STEPS[current].label}
              </span>
            </div>

            {/* Desktop: horizontal rail */}
            <div className="hidden lg:grid lg:grid-cols-7">
              {STEPS.map((s, i) => {
                const done = i < current;
                const active = i === current;
                return (
                  <div key={s.label} className="flex flex-col items-center text-center">
                    <div className="flex w-full items-center">
                      <span
                        className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${
                          i === 0 ? 'opacity-0' : i <= current ? 'bg-red' : 'bg-mist-strong'
                        }`}
                      />
                      <StepNode i={i} done={done} active={active} />
                      <span
                        className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${
                          i === STEPS.length - 1
                            ? 'opacity-0'
                            : i < current
                              ? 'bg-red'
                              : 'bg-mist-strong'
                        }`}
                      />
                    </div>
                    <p
                      className={`mt-4 font-display text-[16px] font-medium uppercase leading-tight transition-colors duration-300 ${
                        done || active ? 'text-ink' : 'text-gravel'
                      }`}
                    >
                      {s.label}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-gravel-faint">
                      {s.who}
                    </p>
                    <p className="mt-2 px-2 text-[12.5px] leading-snug text-gravel">{s.blurb}</p>
                  </div>
                );
              })}
            </div>

            {/* Mobile / tablet: vertical rail */}
            <div className="lg:hidden">
              <div className="mx-auto max-w-[540px]">
                {STEPS.map((s, i) => {
                  const done = i < current;
                  const active = i === current;
                  return (
                    <div key={s.label} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <StepNode i={i} done={done} active={active} />
                        {i < STEPS.length - 1 ? (
                          <span
                            className={`my-1 w-[3px] flex-1 rounded-full transition-colors duration-500 ${
                              done ? 'bg-red' : 'bg-mist-strong'
                            }`}
                          />
                        ) : null}
                      </div>
                      <div className={i < STEPS.length - 1 ? 'pb-8' : ''}>
                        <div className="flex flex-wrap items-baseline gap-x-2.5">
                          <span
                            className={`font-display text-[17px] font-medium uppercase transition-colors duration-300 ${
                              done || active ? 'text-ink' : 'text-gravel'
                            }`}
                          >
                            {s.label}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gravel-faint">
                            {s.who}
                          </span>
                        </div>
                        <p className="mt-1 text-[13.5px] leading-relaxed text-gravel">{s.blurb}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={220}>
          <div className="mt-16 flex flex-wrap justify-center gap-3">
            {FACTS.map((f) => (
              <span
                key={f}
                className="inline-flex items-center rounded-full border border-mist bg-white/70 px-4 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-gravel"
              >
                {f}
              </span>
            ))}
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
