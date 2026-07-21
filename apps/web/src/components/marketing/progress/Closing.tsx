'use client';

/**
 * /progress closing run: photo interlude → cross-links → compact photo CTA.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PhotoBlock, PillLink, Section } from '../ui';

/* ------------------------------------------------------------ interlude */

export function PhotoInterlude() {
  return (
    <Section tone="coal" pad="py-16 sm:py-20">
      <Container wide>
        <Reveal>
          <PhotoBlock
            src="/stock/squat-woman-bw.jpg"
            alt="Athlete squatting a loaded barbell in a dark gym, black and white"
            caption="Week 12 · still showing up"
            className="aspect-[16/9] w-full sm:aspect-[21/10]"
          />
        </Reveal>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------- cross-links */

const LINKS = [
  {
    href: '/training',
    title: 'Train',
    blurb: 'Where the PRs come from — coach-built plans, gym mode and a logger that keeps up.',
  },
  {
    href: '/coaching',
    title: 'Coaching',
    blurb: 'A verified human coach reads your trend and adjusts the plan. No bots.',
  },
  {
    href: '/pricing',
    title: 'Pricing',
    blurb: 'Nepal-fair, globally simple. See exactly what each tier unlocks.',
  },
] as const;

export function CrossLinks() {
  return (
    <Section tone="ink">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display size="md" className="mt-4">
            Progress is the scoreboard. Here&rsquo;s the game.
          </Display>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {LINKS.map((l, i) => (
            <Reveal key={l.href} delay={i * 90}>
              <Link
                href={l.href}
                className="mkt-glass-deep mkt-card-hover group flex min-h-[190px] flex-col justify-between rounded-block p-7 text-snow"
              >
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center self-end rounded-full bg-white/8 text-[15px] transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                >
                  →
                </span>
                <span>
                  <span className="font-display text-2xl font-medium uppercase">{l.title}</span>
                  <span className="mt-2 block text-[14.5px] leading-relaxed text-dim">
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
/* ----------------------------------------------------------- final CTA */

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/stock/running-stairs.jpg"
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover"
      />
      <div aria-hidden className="absolute inset-0 bg-black/70" />
      <Container className="relative z-10 py-28 text-center sm:py-32">
        <Reveal>
          <Display as="h2" size="lg" className="text-snow">
            Day one is
            <br />
            tonight.
          </Display>
        </Reveal>
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-lg text-[16.5px] leading-relaxed text-snow/80">
            Download the app, weigh in tomorrow morning, log one workout. The proof starts
            collecting itself.
          </p>
        </Reveal>
        <Reveal delay={220} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/download">Get the app</PillLink>
          <PillLink href="/pricing" variant="ghost">
            See pricing
          </PillLink>
        </Reveal>
      </Container>
    </section>
  );
}
