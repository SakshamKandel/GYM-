/**
 * /partners FAQ — four honest answers in glass accordions. Commission is
 * answered truthfully as "agreed during onboarding", no invented rates.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const FAQS = [
  {
    q: 'What commission does The GM Method take?',
    a: 'There is no flat public rate — commission is agreed during onboarding, based on your menu, expected volume and delivery setup. You will know the exact number before you sign anything, and it stays in writing.',
  },
  {
    q: 'How do payouts work?',
    a: 'Every delivered order accrues in your portal wallet. Request a payout whenever you like; the GM team processes it to your registered account, and every request and payment stays visible in your ledger.',
  },
  {
    q: 'How is cash on delivery handled?',
    a: 'Digital orders are prepaid through the app, so there is nothing to collect. For COD orders — flagged right on the order card — you collect cash at the door, and the amount reconciles in your wallet when the order is marked delivered.',
  },
  {
    q: 'Who delivers the food?',
    a: 'Your kitchen does, inside the delivery zones you set in your store profile. Each order card shows the address and delivery window, and cutoffs keep runs batched instead of scattered across the day.',
  },
] as const;

export function PartnersFaq() {
  return (
    <Section tone="ink">
      <Container className="max-w-[900px]">
        <Reveal>
          <Eyebrow>Straight answers</Eyebrow>
          <Display size="lg" flavor="steel" className="mt-4">
            Partner FAQ.
          </Display>
        </Reveal>

        <div className="mt-12 flex flex-col gap-3.5">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 90}>
              <details className="group mkt-glass-deep rounded-block px-6 py-5 sm:px-8">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-snow [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-[16px] transition-transform duration-300 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-dim">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
