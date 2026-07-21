'use client';

/**
 * Keep exploring — two glass cards linking to Coaching and Partners.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const LINKS = [
  {
    href: '/coaching',
    label: 'Coaching',
    blurb: 'Real, verified human coaches — programs, diet plans and chat with personal details masked.',
  },
  {
    href: '/partners',
    label: 'Partners',
    blurb: 'Gyms and kitchens that work with us to reach members across Kathmandu valley.',
  },
] as const;

export function AboutCrossLinks() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display size="md" className="mt-4">
            More of the story.
          </Display>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {LINKS.map((l, i) => (
            <Reveal key={l.href} delay={i * 100}>
              <Link
                href={l.href}
                className="mkt-glass-deep mkt-card-hover group flex min-h-[190px] flex-col justify-between rounded-block p-8"
              >
                <span className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
                    {l.label}
                  </span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[15px] text-snow transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </span>
                <span>
                  <span className="block font-display text-3xl font-medium uppercase text-snow">
                    {l.label}
                  </span>
                  <span className="mt-2.5 block text-[14.5px] leading-relaxed text-dim">
                    {l.blurb}
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
