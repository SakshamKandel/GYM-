'use client';

/**
 * Payments — the Nepal-first story: eSewa/Khalti receipt flow as a three-step
 * rail, a perforated coach-code coupon, and the honest app-store note.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const STEPS = [
  {
    n: '01',
    title: 'Pay with eSewa or Khalti',
    body: 'Send the tier amount from the payment sheet in the app. Prices are in NPR — no card, no currency conversion, no international gateway fees.',
  },
  {
    n: '02',
    title: 'Upload your receipt',
    body: 'Attach the payment screenshot right in the app. It lands in the review queue instantly — nothing to email, nothing to chase.',
  },
  {
    n: '03',
    title: 'Verified, dated, done',
    body: 'A human verifies the receipt and your tier is granted from that date — usually the same day. Your full month starts when your access does.',
  },
] as const;

export function Payments() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Payments — Nepal-first, globally ready</Eyebrow>
          <Display className="mt-4 max-w-3xl">
            <span className="mkt-text-steel">Pay like you</span>{' '}
            <span className="mkt-text-ember">live</span>{' '}
            <span className="mkt-text-steel">here.</span>
          </Display>
          <Lead className="mt-6">
            Most fitness apps expect a credit card. Nepal runs on eSewa and Khalti — so
            that&rsquo;s exactly how you pay, with a human verifying every receipt.
          </Lead>
        </Reveal>

        <div className="mt-16 grid gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Step rail */}
          <div className="flex flex-col">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 110} className="flex gap-6">
                <div className="flex flex-col items-center">
                  <span className="mkt-glass flex size-12 shrink-0 items-center justify-center rounded-full font-display text-[16px] font-medium text-snow">
                    {step.n}
                  </span>
                  {i < STEPS.length - 1 ? (
                    <span
                      aria-hidden
                      className="my-2 w-px flex-1 bg-gradient-to-b from-white/20 to-white/5"
                    />
                  ) : null}
                </div>
                <div className={i < STEPS.length - 1 ? 'pb-10' : ''}>
                  <h3 className="pt-2.5 font-display text-xl font-medium uppercase text-snow">
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-dim">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Coupon + store note */}
          <div className="flex flex-col gap-6">
            <Reveal delay={140}>
              <div className="mkt-glass relative overflow-hidden rounded-block p-7 sm:p-8">
                {/* Perforation notches */}
                <span
                  aria-hidden
                  className="absolute -left-3 top-[58%] size-6 rounded-full bg-coal"
                />
                <span
                  aria-hidden
                  className="absolute -right-3 top-[58%] size-6 rounded-full bg-coal"
                />
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-dim">
                  Coach promo code
                </p>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="mkt-text-ember font-display text-6xl font-medium sm:text-7xl">
                    30%
                  </span>
                  <span className="font-display text-2xl font-medium uppercase text-snow">
                    off
                  </span>
                </div>
                <div
                  aria-hidden
                  className="mt-6 border-t border-dashed border-white/15"
                />
                <p className="mt-5 text-[14.5px] leading-relaxed text-dim">
                  Every verified coach has a share code. Enter it at checkout and 30% comes
                  off your tier — and your coach gets credited for the referral.
                </p>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                  Codes come from verified coaches only
                </p>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="mkt-glass-deep rounded-block p-7">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-dim">
                  Paying by card?
                </p>
                <p className="mt-3 text-[14.5px] leading-relaxed text-dim">
                  App-store billing arrives with the store launch — cards at store launch,
                  managed through your Apple or Google account. International pricing is
                  already live in USD, so nothing changes but the checkout.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
