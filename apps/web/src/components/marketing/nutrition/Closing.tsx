'use client';

/**
 * /nutrition closing run — the page's single red band (GM Meals cross-sell),
 * a food photo interlude, sibling-page cross-links, and a cream closing CTA.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PhotoBlock, PillLink, Section } from '../ui';

/* ------------------------------------------------- red meals cross-sell */

export function MealsCrossSell() {
  return (
    <Section tone="red" pad="py-14 sm:py-16">
      <Container wide>
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <Reveal>
            <Display size="md">Too busy to cook?</Display>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-ink/75">
              Macro-counted meals from partner kitchens, delivered across Kathmandu valley —
              and every GM Meals order logs itself to your food diary.
            </p>
          </Reveal>
          <Reveal delay={120} className="shrink-0">
            <PillLink href="/meals" variant="inkOnRed">
              Explore GM Meals
            </PillLink>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------------ photo interlude */

export function NutritionInterlude() {
  return (
    <Section tone="ink" pad="py-14 sm:py-20">
      <Container wide>
        <Reveal>
          <PhotoBlock
            src="/stock/food-healthy.jpg"
            alt="Fresh vegetables and whole foods laid out for a healthy meal"
            caption="Eat real food · log it in seconds"
            className="h-[320px] sm:h-[440px]"
          />
        </Reveal>
      </Container>
    </Section>
  );
}

/* ---------------------------------------------------------- cross-links */

const LINKS = [
  {
    n: '01',
    title: 'Training',
    href: '/training',
    blurb: 'Coach-built plans and a gym mode that flows set to set — the other half of the equation.',
  },
  {
    n: '02',
    title: 'Progress',
    href: '/progress',
    blurb: 'Smoothed weight trends and measurements that prove the diet is working.',
  },
  {
    n: '03',
    title: 'Meals',
    href: '/meals',
    blurb: 'Macro-counted delivery from partner kitchens that logs itself to your diary.',
  },
] as const;

export function NutritionCrossLinks() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display size="md" className="mt-4 max-w-2xl">
            Food is one-third of it.
          </Display>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {LINKS.map((l, i) => (
            <Reveal key={l.href} delay={i * 90}>
              <Link
                href={l.href}
                className="mkt-glass-deep mkt-card-hover group flex min-h-[200px] flex-col justify-between rounded-block p-7 text-snow"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[12px] tracking-[0.2em] text-faint">{l.n}</span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[15px] transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-2xl font-medium uppercase">{l.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-dim">{l.blurb}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ----------------------------------------------------------- final CTA */

export function NutritionClosing() {
  return (
    <Section tone="cream" pad="py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <Eyebrow tone="light">Get started</Eyebrow>
          </Reveal>
          <Reveal delay={80}>
            <Display size="lg" className="mt-4">
              Log your next meal
              <br />
              in <span className="text-red-deep">seconds.</span>
            </Display>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-cream-dim">
              Barcode scan, two-database search, computed targets and water tracking — all of
              it offline-first, none of it behind an ad.
            </p>
          </Reveal>
          <Reveal delay={240} className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <PillLink href="/download">Get the app</PillLink>
            <PillLink href="/pricing" variant="inkOnCream">
              See pricing
            </PillLink>
          </Reveal>
          <Reveal delay={320}>
            <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-cream-dim">
              iOS · Android · Offline-first
            </p>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
