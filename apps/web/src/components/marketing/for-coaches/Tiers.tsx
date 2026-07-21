'use client';

/**
 * Seniority tiers — coal band. Silver / Gold / Elite glass cards with what
 * each rank means, and the request-based upgrade flow.
 */
import { Reveal } from '../motion';
import { Card, Container, Display, Eyebrow, Lead, Section } from '../ui';

const TIERS = [
  {
    name: 'Silver',
    accent: 'mkt-text-steel',
    dot: 'bg-snow/70',
    tag: 'Where everyone starts',
    copy: 'The rank every newly verified coach holds from day one — nothing held back.',
    points: [
      'Full coach console — roster, chat, review queue',
      'Public profile live in the discovery hub',
      'Auto promo code + 30% commission wallet',
    ],
  },
  {
    name: 'Gold',
    accent: 'text-gold',
    dot: 'bg-gold',
    tag: 'A proven record',
    copy: 'Request it once your client record speaks for itself. The gold badge rides your profile everywhere members see you.',
    points: [
      'Gold seniority badge on your discovery card',
      'Upgrade by request, reviewed by the GM team',
      'Your logged milestones make the case',
    ],
  },
  {
    name: 'Elite',
    accent: 'mkt-text-ember',
    dot: 'bg-red',
    tag: 'The top rank',
    copy: 'The mark members look for first. Elite is earned, requested, and reviewed — never bought.',
    points: [
      'Elite badge across profile and discovery',
      'The standing that fills a capacity list',
      'Same review flow — request from your console',
    ],
  },
] as const;

export function TiersSection() {
  return (
    <Section tone="coal" id="tiers">
      <Container wide>
        <Reveal>
          <Eyebrow>Seniority</Eyebrow>
          <Display flavor="steel" size="lg" className="mt-4 max-w-3xl">
            Silver. Gold. Elite.
          </Display>
          <Lead className="mt-6">
            Three coach ranks, worn as a badge on your public profile. You move up by
            request — the GM team reviews your coaching record and answers, so the badge
            actually means something.
          </Lead>
        </Reveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal key={t.name} delay={i * 100}>
              <Card raised hover className="flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <span className={`font-display text-[34px] font-medium uppercase ${t.accent}`}>
                    {t.name}
                  </span>
                  <span aria-hidden className={`size-2.5 rounded-full ${t.dot}`} />
                </div>
                <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
                  {t.tag}
                </p>
                <p className="mt-4 text-[14.5px] leading-relaxed text-dim">{t.copy}</p>
                <div className="mkt-divider my-5" />
                <ul className="flex flex-col gap-3">
                  {t.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-snow">
                      <span
                        aria-hidden
                        className="mt-[7px] size-1.5 shrink-0 rounded-full bg-red"
                      />
                      {p}
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal delay={320}>
          <p className="mt-10 text-center font-mono text-[11.5px] uppercase tracking-[0.18em] text-faint">
            Tier requests live in your console · Reviewed by the GM team
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
