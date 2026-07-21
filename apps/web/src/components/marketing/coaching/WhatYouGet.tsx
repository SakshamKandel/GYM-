'use client';

/**
 * What you actually get — cream editorial band. The assigned-plan screen is
 * presented as a bare chrome-less panel (no device — variety law), beside the
 * tier-gated capability checklist.
 */
import type { ReactNode } from 'react';
import { SCREEN_H, SCREEN_W } from '../PhoneFrame';
import { Reveal } from '../motion';
import { AssignedPlanScreen } from '../screens/AssignedPlanScreen';
import { ArrowLink, CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

/** Bare 334×710 screen slab — rounded glass edge, no device chrome. */
function ScreenPanel({ children, scale = 1 }: { children: ReactNode; scale?: number }) {
  return (
    <div
      aria-hidden
      className="relative"
      style={{ width: SCREEN_W * scale, height: SCREEN_H * scale }}
    >
      <div
        className="mkt-glass relative overflow-hidden rounded-[44px] shadow-phone"
        style={{
          width: SCREEN_W,
          height: SCREEN_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function CoachingWhatYouGet() {
  return (
    <Section tone="cream">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="light">What you get</Eyebrow>
              <Display className="mt-4">
                <span className="text-red-deep">Programmed,</span>
                <br />
                not guessing.
              </Display>
              <Lead tone="light" className="mt-6">
                An active coach doesn&rsquo;t send you PDFs. Workouts appear in your Train
                tab, diet targets in Food, and the conversation lives in one masked,
                in-app chat. What unlocks depends on your member tier.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  Coach-assigned workouts, straight into your Train tab — Silver and up
                </CheckItem>
                <CheckItem tone="light">
                  Personal diet plans with kcal and protein targets — Gold and up
                </CheckItem>
                <CheckItem tone="light">
                  Coach chat — with any active assignment, or always-on with Elite
                </CheckItem>
                <CheckItem tone="light">
                  Coach-logged milestones that build your Progress portfolio
                </CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/pricing" className="mt-8 text-ink">
                Compare member tiers
              </ArrowLink>
            </Reveal>
          </div>

          <Reveal delay={100} className="flex justify-center">
            <div>
              <ScreenPanel scale={0.82}>
                <AssignedPlanScreen />
              </ScreenPanel>
              <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim">
                Assigned week · live in the app
              </p>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
