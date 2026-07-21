/**
 * /partners how-to-join — three numbered glass cards on coal. Joining is
 * human: contact us, onboarding by the GM team, go live.
 */
import { Reveal } from '../motion';
import { ArrowLink, Card, Container, Display, Eyebrow, Lead, Section } from '../ui';

const STEPS = [
  {
    n: '01',
    title: 'Talk to us',
    body: 'Tell us about your kitchen and what you cook best. The GM team replies, talks numbers face to face, and books your onboarding.',
    link: { href: '/contact', label: 'Start the conversation' },
  },
  {
    n: '02',
    title: 'Menu onboarding',
    body: 'We help you load dishes with macros and prices, set delivery zones and cutoffs in your store profile, and walk your staff through the board.',
    link: null,
  },
  {
    n: '03',
    title: 'Go live',
    body: 'Your kitchen appears in the Meals tab of every member’s app. Orders start landing with the next cutoff.',
    link: null,
  },
] as const;

export function JoinSteps() {
  return (
    <Section tone="coal">
      <Container>
        <Reveal>
          <Eyebrow>Getting started</Eyebrow>
          <Display size="lg" flavor="steel" className="mt-4 max-w-2xl">
            Live in three steps.
          </Display>
          <Lead className="mt-6">
            No self-serve forms, no waiting in a queue. A person from the GM team runs your
            onboarding end to end.
          </Lead>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <Card raised hover className="flex h-full min-h-[240px] flex-col">
                <span className="font-mono text-[12px] tracking-[0.2em] text-faint">{s.n}</span>
                <h3 className="mt-5 font-display text-3xl font-medium uppercase">{s.title}</h3>
                <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-dim">{s.body}</p>
                {s.link ? (
                  <ArrowLink href={s.link.href} className="mt-5 text-snow">
                    {s.link.label}
                  </ArrowLink>
                ) : null}
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
