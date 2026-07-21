'use client';

/**
 * The method — a train / track / keep-going triptych on coal. The three words
 * the whole product is named after.
 */
import type { ReactNode } from 'react';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const STEPS: { n: string; word: string; tail: string; body: string; glyph: ReactNode }[] = [
  {
    n: '01',
    word: 'Train',
    tail: 'with a plan',
    body: 'Coach-built or self-built, structured and progressive. A gym mode that flows set to set, a rest timer that starts itself, and PR detection that never misses.',
    glyph: (
      <path
        d="M2 10h3v4H2v-4Zm17 0h3v4h-3v-4ZM6 7h3v10H6V7Zm9 0h3v10h-3V7Zm-6 4h6v2H9v-2Z"
        fill="currentColor"
      />
    ),
  },
  {
    n: '02',
    word: 'Track',
    tail: 'what matters',
    body: 'Sets, food, weight and measurements — signal, not noise. Smoothed trends instead of daily whiplash, and macros without the mental math.',
    glyph: (
      <path d="M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z" fill="currentColor" />
    ),
  },
  {
    n: '03',
    word: 'Keep going',
    tail: '',
    body: 'The hard part. Streaks, PR moments, and a real coach in your corner when you need one. Consistency beats intensity — the app is built to protect it.',
    glyph: (
      <path
        d="M12 2s7 6.5 7 13.5a7 7 0 0 1-14 0C5 11 8 8 8 8s-.5 3.5 1.5 5C10.5 10 12 2 12 2Z"
        fill="currentColor"
      />
    ),
  },
];

export function AboutMethod() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>The GM Method, literally</Eyebrow>
          <Display size="lg" className="mt-4">
            Three words.<br />
            One <span className="mkt-text-ember">habit.</span>
          </Display>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.word} delay={i * 100}>
              <div className="mkt-glass-deep flex h-full min-h-[280px] flex-col justify-between rounded-block p-8">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] tracking-[0.2em] text-faint">{s.n}</span>
                  <span className="flex size-11 items-center justify-center rounded-full bg-red text-ink shadow-ember">
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      {s.glyph}
                    </svg>
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-4xl font-medium uppercase leading-none text-snow">
                    {s.word}
                  </h3>
                  {s.tail ? (
                    <p className="mt-2 font-display text-lg font-medium uppercase tracking-[0.06em] text-red-glow">
                      {s.tail}
                    </p>
                  ) : null}
                  <p className="mt-4 text-[14.5px] leading-relaxed text-dim">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
