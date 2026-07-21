'use client';

/**
 * The page's single RED band — the 30/30 promo economics. Giant Oswald
 * "30 / 30" motif, black on red, plus the four-step money flow strip.
 */
import { CountUp, Reveal } from '../motion';
import { Container, Display, Eyebrow, Lead, Section } from '../ui';

const FLOW = [
  { n: '01', title: 'Share your code', copy: 'Every verified coach gets one, auto-issued. Yours might read GAURAV30.' },
  { n: '02', title: 'Client subscribes', copy: 'They take 30% off any tier, in NPR or USD — whichever region they pay in.' },
  { n: '03', title: 'Ledger credit', copy: '30% commission lands in your wallet ledger the moment the purchase clears.' },
  { n: '04', title: 'Request payout', copy: 'One tap in the console. The GM team processes it through the payout queue.' },
] as const;

export function EarnSection() {
  return (
    <Section tone="red" id="earn">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
          {/* giant motif */}
          <Reveal className="order-2 lg:order-1">
            <div className="flex items-end justify-center gap-4 sm:gap-7">
              <div className="text-center">
                <div className="font-display text-[100px] font-medium leading-[0.85] text-ink sm:text-[170px]">
                  <CountUp to={30} duration={1100} />
                </div>
                <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ink/70">
                  % off for clients
                </p>
              </div>
              <div
                aria-hidden
                className="pb-8 font-display text-[64px] font-medium leading-[0.85] text-ink/35 sm:text-[110px]"
              >
                /
              </div>
              <div className="text-center">
                <div className="font-display text-[100px] font-medium leading-[0.85] text-ink sm:text-[170px]">
                  <CountUp to={30} duration={1100} />
                </div>
                <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ink/70">
                  % commission to you
                </p>
              </div>
            </div>
          </Reveal>

          {/* copy */}
          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="red">Earn — the 30 / 30 rule</Eyebrow>
              <Display size="lg" className="mt-4">
                One code.
                <br />
                Paid both ways.
              </Display>
              <Lead tone="red" className="mt-6">
                Your promo code is a discount for them and a paycheck for you. Clients save
                30% on any subscription; you earn 30% commission on every purchase made with
                it — itemised to the rupee in your wallet ledger.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-5 font-mono text-[11.5px] uppercase tracking-[0.18em] text-ink/60">
                No invoicing · No chasing · No spreadsheets
              </p>
            </Reveal>
          </div>
        </div>

        {/* money flow strip */}
        <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((step, i) => (
            <Reveal key={step.n} delay={i * 90} className="relative">
              <div className="h-full rounded-block bg-ink/8 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-medium tracking-[0.2em] text-ink/55">
                    {step.n}
                  </span>
                  {i < FLOW.length - 1 ? (
                    <span aria-hidden className="text-[15px] text-ink/40">
                      →
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-5 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-red"
                    >
                      ✓
                    </span>
                  )}
                </div>
                <h3 className="mt-4 font-display text-[21px] font-medium uppercase leading-tight text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/75">{step.copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
