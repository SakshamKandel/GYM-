'use client';

/**
 * The page's single RED band — the PII-guard story. A live masking demo
 * (messages flip raw → masked on a loop) beside the shield motif. Pure SVG +
 * DOM, no device.
 */
import { Reveal, useStepLoop } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

function Shield({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={(size * 26) / 22}
      viewBox="0 0 22 26"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M11 1 21 4.6v7.1c0 6.1-4.1 10.8-10 13.3C5.1 22.5 1 17.8 1 11.7V4.6L11 1Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m6.8 12.6 2.9 2.9 5.5-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MESSAGES = [
  {
    from: 'you',
    name: 'You → Coach Maya',
    raw: 'Sure — just call me, 9851 022 334',
    masked: 'Sure — just call me, ●●●● ●●● ●●●',
    kind: 'Phone number',
  },
  {
    from: 'coach',
    name: 'Coach Maya → You',
    raw: 'Send your log to maya.s@gmail.com',
    masked: 'Send your log to ●●●●●●●●●●●●●●',
    kind: 'Email address',
  },
] as const;

export function CoachingSafety() {
  const [ref, step] = useStepLoop(5, 1400, 4);
  // step 0: msg1 raw · 1: msg1 masked · 2: msg2 raw · 3: msg2 masked · 4: hold
  const maskedAt = [1, 3] as const;

  return (
    <Section tone="red">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="red">Privacy by design</Eyebrow>
              <Display className="mt-4">
                Your number
                <br />
                stays yours.
              </Display>
              <Lead tone="red" className="mt-6">
                Every message between you and your coach passes through a server-side PII
                mask before delivery. Phone numbers and emails are hidden automatically —
                in both directions — so the relationship stays inside the app, where
                it&rsquo;s covered.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="red">
                  Phone numbers and emails auto-masked, member → coach and coach → member
                </CheckItem>
                <CheckItem tone="red">
                  Runs on the server and it&rsquo;s unit-tested — not a client-side filter
                  you can switch off
                </CheckItem>
                <CheckItem tone="red">
                  Coaches are admin-verified before they ever appear in discovery
                </CheckItem>
              </ul>
            </Reveal>
          </div>

          {/* Masking demo */}
          <Reveal delay={100}>
            <div className="relative mx-auto w-full max-w-[460px]">
              <Shield
                size={300}
                className="pointer-events-none absolute -right-10 -top-14 text-ink/10"
              />
              <div ref={ref} className="relative rounded-block bg-ink p-6 shadow-pop sm:p-7">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                    Coach chat · live mask
                  </p>
                  <span className="flex items-center gap-1.5 rounded-full bg-red/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-red-glow">
                    <Shield size={11} className="text-red-glow" />
                    Server-side
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-4">
                  {MESSAGES.map((m, i) => {
                    const visible = step >= i * 2;
                    const masked = step >= maskedAt[i];
                    return (
                      <div
                        key={m.name}
                        className={`transition-all duration-500 ${
                          visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                        } ${m.from === 'you' ? 'self-end text-right' : 'self-start'}`}
                      >
                        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                          {m.name}
                        </p>
                        <div
                          className={`inline-block max-w-[300px] rounded-[16px] px-4 py-3 text-left text-[13.5px] leading-snug ${
                            m.from === 'you' ? 'bg-cream text-ink' : 'bg-charcoal-2 text-snow'
                          }`}
                        >
                          {masked ? m.masked : m.raw}
                        </div>
                        <div
                          className={`mt-1.5 flex items-center gap-1.5 transition-opacity duration-500 ${
                            m.from === 'you' ? 'justify-end' : ''
                          } ${masked ? 'opacity-100' : 'opacity-0'}`}
                        >
                          <span className="rounded-full bg-red px-2 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink">
                            {m.kind} masked
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mkt-divider mt-5" />
                <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
                  maskPii() · @gym/shared · unit-tested
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
