'use client';

/**
 * Page tail — photo interlude, cross-links to sibling pages, and the closing
 * CTA over a scrimmed squat portrait.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PhotoBlock, PillLink, Section } from '../ui';

export function CoachingInterlude() {
  return (
    <Section tone="ink" pad="py-10 sm:py-14" ambient="none">
      <Container wide>
        <Reveal>
          <PhotoBlock
            src="/stock/overhead-press-woman.jpg"
            alt="Woman pressing a barbell overhead under coaching supervision"
            caption="Coached lifters train with intent"
            className="h-[320px] sm:h-[460px]"
          />
        </Reveal>
      </Container>
    </Section>
  );
}

const LINKS = [
  {
    title: 'Pricing',
    href: '/pricing',
    blurb: 'Silver, Gold and Elite tiers — priced in NPR for Nepal, USD for everyone else.',
  },
  {
    title: 'For coaches',
    href: '/for-coaches',
    blurb: 'Run your roster, log milestones, earn through promo codes and payouts.',
  },
  {
    title: 'Progress',
    href: '/progress',
    blurb: 'Where coach-logged milestones land — next to trends, PRs and streaks.',
  },
] as const;

export function CoachingCrossLinks() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display size="md" className="mt-4">
            Where to next.
          </Display>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {LINKS.map((l, i) => (
            <Reveal key={l.href} delay={i * 90}>
              <Link
                href={l.href}
                className="mkt-glass-deep mkt-card-hover group flex min-h-[190px] flex-col justify-between rounded-block p-7 text-snow"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-display text-2xl font-medium uppercase">{l.title}</h3>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[15px] transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <p className="mt-4 text-[14.5px] leading-relaxed text-dim">{l.blurb}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function CoachingCta() {
  return (
    <section className="relative overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/stock/woman-squat-portrait-bw.jpg"
        alt="Black-and-white portrait of a woman set up for a barbell squat"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-black/70" />
      <Container className="relative z-10 py-28 text-center sm:py-36">
        <Reveal>
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-dim">
            Mentorship · The GM Method
          </p>
        </Reveal>
        <Reveal delay={90}>
          <h2 className="mt-5 font-display text-5xl font-medium uppercase leading-[0.95] sm:text-6xl md:text-7xl">
            <span className="mkt-text-steel">A coach in</span>
            <br />
            <span className="mkt-text-steel">your </span>
            <span className="mkt-text-ember">corner.</span>
          </h2>
        </Reveal>
        <Reveal delay={170}>
          <p className="mx-auto mt-6 max-w-xl text-[16.5px] leading-relaxed text-dim">
            Download the app, open Coaching, and send your one request. The rest — program,
            plan, chat — happens where you already train.
          </p>
        </Reveal>
        <Reveal delay={250} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/download">Get the app</PillLink>
          <PillLink href="/pricing" variant="ghost">
            Compare tiers
          </PillLink>
        </Reveal>
      </Container>
    </section>
  );
}
