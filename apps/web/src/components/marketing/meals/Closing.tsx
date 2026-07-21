'use client';

/**
 * Page close — sibling-page cross-links (glass cards) + a compact cream CTA
 * band (deliberately not Home's CtaBand).
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

const LINKS = [
  {
    title: 'Food',
    href: '/nutrition',
    blurb: 'Every delivered meal lands in the same diary you scan barcodes into.',
  },
  {
    title: 'Partners',
    href: '/partners',
    blurb: 'Run a kitchen or restaurant? Join GM Meals and get your own portal.',
  },
  {
    title: 'Pricing',
    href: '/pricing',
    blurb: 'The member card — and its restaurant discounts — rides along with your tier.',
  },
] as const;

export function CrossLinks() {
  return (
    <Section tone="ink" pad="py-20 sm:py-24">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display size="md" className="mt-4">
            Meals is one piece.
          </Display>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
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
                <div>
                  <h3 className="font-display text-2xl font-medium uppercase">{l.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-dim">{l.blurb}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function MealsCta() {
  return (
    <Section tone="cream" pad="py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Reveal>
            <Eyebrow tone="light">GM Meals</Eyebrow>
            <Display size="lg" className="mt-4">
              Dinner sorted.
              <br />
              Diary sorted.
            </Display>
            <Lead tone="light" className="mx-auto mt-6">
              Order once or set a weekly plan — cooked across town, tracked through seven
              states, and logged into your diary before the box is open.
            </Lead>
          </Reveal>
          <Reveal delay={140} className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <PillLink href="/download">Get the app</PillLink>
            <PillLink href="/pricing" variant="inkOnCream">
              See pricing
            </PillLink>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
