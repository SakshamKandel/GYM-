'use client';

/**
 * Coach-logged milestones — copy beside a cropped close-up of the coach
 * profile screen, zoomed onto the milestone rows (variety law: crop, not a
 * third device).
 */
import { SCREEN_H, SCREEN_W } from '../PhoneFrame';
import { Reveal } from '../motion';
import { CoachProfileScreen } from '../screens/CoachProfileScreen';
import { ArrowLink, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function CoachingMilestones() {
  return (
    <Section tone="ink" grid>
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Cropped close-up — milestone rows only */}
          <Reveal className="order-2 lg:order-1">
            <div className="mx-auto w-full max-w-[440px]">
              <div className="mkt-glass relative h-[340px] overflow-hidden rounded-block">
                <div
                  aria-hidden
                  className="absolute left-1/2 top-0"
                  style={{
                    width: SCREEN_W,
                    height: SCREEN_H,
                    transform: 'translateX(-50%) translateY(-168px) scale(1.22)',
                    transformOrigin: 'top center',
                  }}
                >
                  <div className="relative size-full">
                    <CoachProfileScreen />
                  </div>
                </div>
                {/* Edge fades so the crop reads as a lens, not a cut */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-ink/85 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-ink/85 to-transparent" />
              </div>
              <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                Coach-logged · dated · public on the profile
              </p>
            </div>
          </Reveal>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow>Milestones</Eyebrow>
              <Display className="mt-4">
                Wins, on
                <br />
                the record.
              </Display>
              <Lead className="mt-6">
                When your coach logs a milestone — a first strict pull-up, a 16-week cut, a
                100&nbsp;kg squat — it lands in your Progress portfolio with their name on
                it. And because coaches&rsquo; logged milestones are public, the next member
                choosing a coach reads real receipts, not marketing.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <div className="mt-8 flex flex-col gap-3">
                {[
                  ['Logged by the coach', 'not self-reported — your mentor writes it'],
                  ['Lands on your portfolio', 'lives in Progress next to PRs and trends'],
                  ['Builds their track record', 'the same entries power coach discovery'],
                ].map(([title, sub], i) => (
                  <div key={title} className="mkt-glass-deep flex items-center gap-4 rounded-block px-5 py-4">
                    <span className="font-mono text-[11px] tracking-[0.18em] text-faint">
                      0{i + 1}
                    </span>
                    <p className="text-[14.5px] leading-snug">
                      <span className="font-semibold text-snow">{title}</span>
                      <span className="text-dim"> — {sub}</span>
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/progress" className="mt-8 text-red">
                See how Progress works
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
