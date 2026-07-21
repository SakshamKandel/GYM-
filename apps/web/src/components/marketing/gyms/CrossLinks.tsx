'use client';

/**
 * "Keep exploring" cross-links (coal) — glass cards to Training, Meals and
 * Download.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const LINKS = [
  {
    n: '01',
    title: 'Training',
    href: '/training',
    blurb: 'Coach-built plans, a gym mode that flows set to set, and PR detection that never misses.',
  },
  {
    n: '02',
    title: 'Meals',
    href: '/meals',
    blurb: 'Macro-counted meals from partner kitchens, delivered across Kathmandu valley.',
  },
  {
    n: '03',
    title: 'Download',
    href: '/download',
    blurb: 'iOS and Android. Offline-first, no ads — log a set in under 100 ms, even underground.',
  },
] as const;

export function CrossLinks() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Keep exploring</Eyebrow>
          <Display className="mt-4">Found the gym. Now the rest.</Display>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((link, i) => (
            <Reveal key={link.n} delay={i * 90}>
              <Link
                href={link.href}
                className="mkt-glass-deep mkt-card-hover group flex min-h-[210px] flex-col justify-between rounded-block p-7 text-snow"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[12px] tracking-[0.2em] text-faint">{link.n}</span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[15px] text-snow transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-3xl font-medium uppercase">{link.title}</h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-dim">{link.blurb}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
