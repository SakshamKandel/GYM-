'use client';

/**
 * Wallet section v3 — paper band. The coach wallet console mock
 * (BrowserFrame, the real light-SaaS console look) drifting on a subtle
 * parallax beside payout copy: itemised ledger, payout requests, regional
 * pricing.
 */
import { Parallax, Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';
import { CoachWalletMock } from './CoachWalletMock';

export function WalletSection() {
  return (
    <Section tone="paper" id="wallet">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* copy */}
          <div>
            <Reveal>
              <Eyebrow tone="light">Wallet &amp; payouts</Eyebrow>
              <Display size="lg" className="mt-4">
                Every rupee,
                <br />
                itemised.
              </Display>
              <Lead tone="light" className="mt-6">
                Commission is not a promise on a dashboard. Every purchase made with your code
                shows up on its own line, with the date, the moment the money clears.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  One line per sale, so you can check your own earnings any time.
                </CheckItem>
                <CheckItem tone="light">
                  Ask for a payout from your console whenever you want it, and the GM team sends
                  the money.
                </CheckItem>
                <CheckItem tone="light">
                  Regional pricing built in, so commission tracks what your client actually paid,
                  in NPR or USD.
                </CheckItem>
              </ul>
            </Reveal>
          </div>

          {/* wallet console */}
          <Reveal delay={160} className="flex justify-center lg:justify-end">
            <Parallax range={32}>
              <CoachWalletMock className="w-full max-w-[560px]" />
            </Parallax>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
