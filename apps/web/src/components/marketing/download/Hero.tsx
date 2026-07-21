'use client';

/**
 * Download hero — the Welcome screen dead-center, flanked by copy on the left
 * and quick facts on the right. Ember aurora + blueprint grid over near-black.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { Container, Display, Eyebrow, Lead, PillLink } from '../ui';

const FACTS = [
  { k: 'Free', v: 'Starter tier, forever' },
  { k: 'No login', v: 'the whole tracker, no account' },
  { k: 'Offline', v: 'every set logs without signal' },
  { k: 'iOS + Android', v: 'one app, both stores' },
] as const;

export function DownloadHero() {
  return (
    <div className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pb-24 pt-[120px] sm:pt-[140px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_auto_1fr]">
          {/* Left copy */}
          <div className="lg:pr-4">
            <Reveal>
              <Eyebrow>Download — iOS &amp; Android</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display as="h1" size="lg" className="mt-5">
                <span className="mkt-text-steel">Get the app.</span>
                <br />
                <span className="mkt-text-steel">Skip the</span>{' '}
                <span className="mkt-text-ember">sign-up.</span>
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-6">
                Use the whole tracker without ever making an account. Log workouts, food and
                weight the first night, offline. Sign in later only if you want your data in the
                cloud.
              </Lead>
            </Reveal>
            <Reveal delay={240} className="mt-8 flex flex-wrap items-center gap-4">
              <PillLink href="/contact">Get early access</PillLink>
              <PillLink href="/pricing" variant="ghost">
                See pricing
              </PillLink>
            </Reveal>
          </div>

          {/* Center device */}
          <Reveal delay={200} className="flex justify-center">
            <PhoneFrame tilt="none" scale={0.9} priority>
              <WelcomeScreen />
            </PhoneFrame>
          </Reveal>

          {/* Right quick facts */}
          <Reveal delay={300} className="lg:pl-4">
            <div className="mkt-glass rounded-block p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                What you&rsquo;re getting
              </p>
              <ul className="mt-5 flex flex-col">
                {FACTS.map((f, i) => (
                  <li key={f.k}>
                    {i > 0 ? <div className="mkt-divider my-4" /> : null}
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-display text-[19px] font-medium uppercase text-snow">
                        {f.k}
                      </span>
                      <span className="text-right text-[12.5px] leading-tight text-dim">{f.v}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Container>
    </div>
  );
}
