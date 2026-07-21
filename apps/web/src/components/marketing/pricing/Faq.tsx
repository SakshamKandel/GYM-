'use client';

/**
 * Pricing FAQ — native <details>/<summary> in glass cards, no JS accordion.
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, Lead, Section } from '../ui';

const FAQS = [
  {
    q: 'Can I switch tiers whenever I want?',
    a: 'Yes. Upgrade, downgrade or cancel anytime from the app. Tier grants are dated — a new payment extends your access rather than overwriting time you already paid for.',
  },
  {
    q: 'Why are Nepal and international prices different?',
    a: 'They are set separately, on purpose. Nepal pays a fair local price in NPR; everyone else pays in USD. Neither is a conversion of the other — both come from the same live catalog the app charges from.',
  },
  {
    q: 'How long does receipt approval take in Nepal?',
    a: 'Usually the same day. Your eSewa or Khalti receipt goes straight into the review queue, a human verifies it, and your tier starts dated from the approval — so you never lose paid days to processing.',
  },
  {
    q: 'What if I need a refund?',
    a: 'Message support from inside the app. Refunds are reviewed and handled by a human, case by case — no bots, no form mazes. If a charge is wrong, we fix it.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'Nothing is deleted. You drop to Starter and keep every workout log, PR, weight trend and food entry — the whole self-tracking app stays free. Your data also lives on your device, offline-first.',
  },
  {
    q: 'Can I pay with a card?',
    a: 'Cards arrive at the app-store launch, billed through your Apple or Google account. Until then, Nepal pays via eSewa or Khalti with same-day receipt verification.',
  },
] as const;

export function Faq() {
  return (
    <Section tone="ink">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <Eyebrow>FAQ</Eyebrow>
            <Display className="mt-4">
              <span className="mkt-text-steel">Asked, answered.</span>
            </Display>
            <Lead className="mt-6 max-w-sm">
              The short version: start free, pay locally, cancel without losing a single
              logged set.
            </Lead>
            <div className="mt-8">
              <ArrowLink href="/contact" className="text-snow">
                Still curious? Talk to us
              </ArrowLink>
            </div>
          </Reveal>

          <div className="flex flex-col gap-3.5">
            {FAQS.map((item, i) => (
              <Reveal key={item.q} delay={i * 70}>
                <details className="group mkt-glass-deep rounded-block px-6 sm:px-7">
                  <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[15.5px] font-semibold text-snow [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-[16px] text-snow transition-transform duration-300 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-6 text-[14.5px] leading-relaxed text-dim">
                    {item.a}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
