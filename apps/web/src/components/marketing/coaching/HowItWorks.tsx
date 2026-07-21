'use client';

/**
 * How coaching works — three numbered glass cards (browse → accept →
 * programmed), no device in sight. The mechanics are the visual.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const STEPS = [
  {
    n: '01',
    title: 'Browse & request',
    body: 'Every coach profile is public — headline, specialties, certifications, years of practice and live capacity. Pick one and send a request. You can only hold one pending request at a time, so choose like it matters.',
    tag: 'One pending request per member',
  },
  {
    n: '02',
    title: 'Coach accepts',
    body: 'Coaches run real rosters with hard capacity caps — no overselling. When yours accepts, the assignment goes live instantly. If a roster is full, the card says so before you waste a week waiting.',
    tag: 'Capacity-gated rosters',
  },
  {
    n: '03',
    title: 'Get programmed',
    body: 'Assigned workouts land in your Train tab, diet plans in Food, and chat opens the moment the assignment is active. Your coach logs your milestones as you hit them — dated, on the record.',
    tag: 'Workouts · diet · chat',
  },
] as const;

export function CoachingHowItWorks() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
          <Display size="lg" className="mt-4 max-w-3xl">
            Three steps to coached.
          </Display>
          <Lead className="mt-6">
            No forms, no phone calls, no sales chat. The whole loop — request, accept,
            program — runs inside the app.
          </Lead>
        </Reveal>

        <div className="mt-16 grid gap-4 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div className="mkt-glass-deep mkt-card-hover flex min-h-[320px] flex-col rounded-block p-7 sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="mkt-text-steel font-display text-5xl font-medium">{s.n}</span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[15px] text-snow"
                  >
                    {i < STEPS.length - 1 ? '→' : '✓'}
                  </span>
                </div>
                <h3 className="mt-6 font-display text-2xl font-medium uppercase">{s.title}</h3>
                <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-dim">{s.body}</p>
                <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                  {s.tag}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <div className="mkt-divider mt-14" />
          <p className="mt-6 text-center font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
            Decline or withdraw any time — requests never lock you in
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
