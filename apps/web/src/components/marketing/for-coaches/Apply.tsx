'use client';

/**
 * How to apply — ink band, three numbered steps from application to first
 * client. Oversized steel step numerals, glass-deep cards.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, PillLink, Section } from '../ui';

const STEPS = [
  {
    n: '01',
    title: 'Apply in the app',
    copy: 'Self-serve, from your phone: headline, specialties, certifications, years of coaching and the capacity you want to carry.',
  },
  {
    n: '02',
    title: 'Get verified',
    copy: 'The GM team reviews every application by hand. Verified means verified — only real coaches make the discovery hub.',
  },
  {
    n: '03',
    title: 'Start coaching',
    copy: 'Your profile goes live, your promo code is auto-issued, and your console is open. Accept requests up to your cap.',
  },
] as const;

export function ApplySection() {
  return (
    <Section tone="ink" id="apply">
      <Container wide>
        <Reveal>
          <Eyebrow>How to apply</Eyebrow>
          <Display flavor="steel" size="lg" className="mt-4 max-w-3xl">
            Three steps to
            <br />
            your first client.
          </Display>
          <Lead className="mt-6">
            No forms buried in email threads, no waiting rooms. The application lives in the
            app, and the review is done by people who coach.
          </Lead>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div className="mkt-glass-deep flex h-full flex-col rounded-block p-7">
                <div className="mkt-text-steel font-display text-[56px] font-medium leading-none">
                  {s.n}
                </div>
                <h3 className="mt-5 font-display text-[23px] font-medium uppercase leading-tight text-snow">
                  {s.title}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-dim">{s.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={360} className="mt-12 flex flex-wrap items-center gap-4">
          <PillLink href="/download">Get the app &amp; apply</PillLink>
          <PillLink href="/contact" variant="ghost" small>
            Questions first? Talk to us
          </PillLink>
        </Reveal>
      </Container>
    </Section>
  );
}
