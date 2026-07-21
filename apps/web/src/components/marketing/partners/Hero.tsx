/**
 * /partners hero — cream tone, Airmee-boost energy. Copy left, the live order
 * board in a perspective-tilted BrowserFrame right.
 */
import { BrowserFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, Lead, PillLink } from '../ui';
import { LiveOrdersMock } from './LiveOrdersMock';

const CHIPS = [
  'One-off + weekly orders',
  'Cutoff-batched prep',
  'Prepaid + COD',
  'Own portal login',
] as const;

export function PartnersHero() {
  return (
    <div className="mkt-noise relative overflow-hidden bg-cream pb-20 pt-[120px] text-ink sm:pb-24 sm:pt-[140px]">
      <Container wide className="relative z-10">
        <div className="grid items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <Reveal>
              <Eyebrow tone="light">GM Meals · Partner kitchens</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display as="h1" size="xl" className="mt-5">
                Your kitchen.
                <br />
                Our <span className="text-red-deep">members.</span>
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead tone="light" className="mt-7">
                GM members plan food by the numbers — and order meals that hit them, one-off or on
                a weekly subscription. Cook what you&rsquo;re great at; the partner portal handles
                orders, prep and payouts.
              </Lead>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
              <PillLink href="/contact" variant="inkOnCream">
                Become a partner
              </PillLink>
              <ArrowLink href="/partner/login" className="text-ink">
                Partner sign-in
              </ArrowLink>
            </Reveal>
            <Reveal delay={320}>
              <ul className="mt-9 flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <li
                    key={c}
                    className="rounded-full border border-ink/15 px-3.5 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-cream-dim"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <div
              className="mx-auto w-full max-w-[640px]"
              style={{ transform: 'perspective(1800px) rotateY(-7deg) rotateX(3deg) rotateZ(0.5deg)' }}
            >
              <BrowserFrame url="gm-method.app/partner">
                <LiveOrdersMock />
              </BrowserFrame>
            </div>
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
