'use client';

/**
 * Principles — four glass cards, each with a small line glyph. These are the
 * rules the whole product is held to (mirrors CLAUDE.md hard rules).
 */
import type { ReactNode } from 'react';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const PRINCIPLES: { title: string; body: string; glyph: ReactNode }[] = [
  {
    title: 'Offline-first',
    body: 'Gyms have bad signal. Every set writes to your phone first and syncs later. Logging never waits for the network — it confirms in under 100 ms.',
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.4-1.3" />
        <path d="M17 10a4 4 0 0 1 1.2 7.7" />
        <path d="M4 4l16 16" />
      </g>
    ),
  },
  {
    title: 'Accessible',
    body: '48dp touch targets, 16px+ body text, 4.5:1 contrast and your system font-scale respected. Usable with gloves on and sweat in your eyes.',
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
        <path d="M7 10.5c1.6.7 3.3 1 5 1s3.4-.3 5-1" />
        <path d="M12 11.5V16m0 0-2 3.5M12 16l2 3.5" />
      </g>
    ),
  },
  {
    title: 'Private',
    body: 'No ads. We never sell your data. Coach chat masks personal details on the server, and your progress photos stay yours — authenticated delivery only.',
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10.5" width="14" height="9" rx="2.5" />
        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        <path d="M12 14v2" />
      </g>
    ),
  },
  {
    title: 'Tested',
    body: 'PR detection, macro math and weight smoothing are unit-tested. The numbers you see are the numbers that are true — not a best guess.',
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="4.5" width="12" height="15" rx="2.5" />
        <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
        <path d="M9 11.5l2 2 4-4.5" />
      </g>
    ),
  },
];

export function AboutPrinciples() {
  return (
    <Section tone="ink">
      <Container wide>
        <Reveal>
          <Eyebrow>What we hold the line on</Eyebrow>
          <Display size="lg" className="mt-4 max-w-3xl">
            Four rules, no<br />
            exceptions.
          </Display>
          <Lead className="mt-6">
            These aren&rsquo;t taglines. They&rsquo;re written into the codebase as hard rules
            every feature has to pass before it ships.
          </Lead>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={(i % 2) * 100}>
              <div className="mkt-glass-deep flex h-full min-h-[220px] flex-col rounded-block p-8">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-red/12 text-red-glow">
                  <svg width="26" height="26" viewBox="0 0 24 24">
                    {p.glyph}
                  </svg>
                </span>
                <h3 className="mt-6 font-display text-2xl font-medium uppercase text-snow">
                  {p.title}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-dim">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
