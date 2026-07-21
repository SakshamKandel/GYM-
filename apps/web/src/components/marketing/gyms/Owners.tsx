'use client';

/**
 * Owners band (cream) — "Run a gym in the valley?" Three plain steps to get
 * listed via the contact page. The editorial counterpoint before the close.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

const STEPS = [
  {
    n: '01',
    title: 'Reach out',
    body: 'Tell us about your gym through the contact page — where it is, what it offers, when it opens.',
  },
  {
    n: '02',
    title: 'We verify',
    body: 'The GM team confirms photos, hours and location details with you directly. Placement can’t be bought.',
  },
  {
    n: '03',
    title: 'You’re listed',
    body: 'Your gym goes live in the Gyms tab with a full detail page, an exact pin and one-tap directions.',
  },
] as const;

export function OwnersBand() {
  return (
    <Section tone="cream">
      <Container wide>
        <div className="max-w-2xl">
          <Reveal>
            <Eyebrow tone="light">For gym owners</Eyebrow>
            <Display className="mt-4">
              Run a gym
              <br />
              in the valley?
            </Display>
          </Reveal>
          <Reveal delay={100}>
            <Lead tone="light" className="mt-6">
              The Gyms tab is curated by the GM team, not scraped from the internet.
              Every listing is added and maintained by hand — and getting yours in front
              of people who train every day starts with one message.
            </Lead>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 110}>
              <p className="font-mono text-[12px] font-medium tracking-[0.22em] text-red-deep">
                {step.n}
              </p>
              <h3 className="mt-3 font-display text-[22px] font-medium uppercase leading-tight">
                {step.title}
              </h3>
              <p className="mt-2.5 max-w-[34ch] text-[14.5px] leading-relaxed text-cream-dim">
                {step.body}
              </p>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-12">
          <PillLink href="/contact" variant="inkOnCream">
            Get your gym listed
          </PillLink>
        </Reveal>
      </Container>
    </Section>
  );
}
