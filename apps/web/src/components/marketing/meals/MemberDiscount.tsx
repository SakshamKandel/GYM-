'use client';

/**
 * Member discounts — the page's single RED band. Ink membership card + a
 * looping counter-side verification vignette (code → checking → verified).
 */
import { Reveal, useStepLoop } from '../motion';
import {
  CheckItem,
  Container,
  Display,
  Eyebrow,
  Lead,
  LogoMark,
  PillLink,
  Section,
} from '../ui';

const CODE = '5219 8834 0417 2263';

export function MemberDiscount() {
  // 0–1 card at the counter · 2 checking · 3–5 verified.
  const [ref, step] = useStepLoop(6, 1200, 4);
  const state = step <= 1 ? 'idle' : step === 2 ? 'checking' : 'verified';

  return (
    <Section tone="red">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="red">Member discounts</Eyebrow>
              <Display className="mt-4">
                Your card works
                <br />
                at the table.
              </Display>
              <Lead tone="red" className="mt-6">
                Every GM membership comes with a member card and code. Partner restaurants
                verify the code right at the counter and apply the member discount — no
                coupons, no screenshots, no arguing.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="red">
                  Show the card in the app — the code reads in groups of four
                </CheckItem>
                <CheckItem tone="red">
                  The restaurant verifies it in seconds on their partner portal
                </CheckItem>
                <CheckItem tone="red">
                  They see your first name, tier and validity — nothing else
                </CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200} className="mt-9">
              <PillLink href="/pricing" variant="inkOnRed">
                See what comes with the card
              </PillLink>
            </Reveal>
          </div>

          <Reveal delay={100}>
            <div ref={ref} className="mx-auto w-full max-w-[460px]">
              {/* Membership card */}
              <div className="rounded-block bg-ink p-7 shadow-pop sm:p-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <LogoMark size={30} />
                    <span className="font-display text-[14px] font-medium uppercase tracking-[0.08em] text-snow">
                      The GM Method
                    </span>
                  </div>
                  <span className="rounded-full bg-cream px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink">
                    Gold
                  </span>
                </div>
                <p className="mt-9 font-mono text-[18px] tracking-[0.14em] text-snow sm:text-[20px]">
                  {CODE}
                </p>
                <div className="mt-8 flex items-end justify-between">
                  <div>
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-faint">
                      Member
                    </p>
                    <p className="mt-1 font-display text-[16px] font-medium uppercase text-snow">
                      Aarav
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-faint">
                      Valid thru
                    </p>
                    <p className="mt-1 font-display text-[16px] font-medium uppercase text-snow">
                      08 / 27
                    </p>
                  </div>
                </div>
              </div>

              {/* Restaurant counter panel */}
              <div className="relative -mt-5 ml-6 rounded-inner bg-cream p-5 shadow-pop sm:ml-12">
                <div className="relative h-[64px]">
                  {/* idle */}
                  <div
                    className={`absolute inset-0 transition-opacity duration-300 ${
                      state === 'idle' ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                  >
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-cream-dim">
                      Partner counter — verify member
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="font-mono text-[13.5px] tracking-[0.1em] text-ink">
                        {CODE}
                      </span>
                      <span className="rounded-full bg-ink px-3.5 py-1.5 text-[11px] font-semibold text-snow">
                        Verify
                      </span>
                    </div>
                  </div>
                  {/* checking */}
                  <div
                    className={`absolute inset-0 flex items-center gap-3 transition-opacity duration-300 ${
                      state === 'checking' ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                  >
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="size-1.5 animate-pulse rounded-full bg-ink/60"
                          style={{ animationDelay: `${i * 160}ms` }}
                        />
                      ))}
                    </span>
                    <p className="text-[13px] font-semibold text-ink">Checking code…</p>
                  </div>
                  {/* verified */}
                  <div
                    className={`absolute inset-0 flex items-center gap-3.5 transition-opacity duration-300 ${
                      state === 'verified' ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-red">
                      ✓
                    </span>
                    <div>
                      <p className="text-[13.5px] font-bold text-ink">Aarav · Gold member</p>
                      <p className="mt-0.5 text-[11.5px] font-medium text-cream-dim">
                        Member discount applied
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
