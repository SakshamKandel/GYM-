'use client';

/**
 * Plans section (paper) — PlanBuilderScreen in a parallax-drifting device,
 * copy on coach-built vs build-your-own plans. The ink "assigned" card is
 * the section's Iron moment against the white hairline card.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Parallax, Reveal, Stagger, StaggerItem } from '../motion';
import { PlanBuilderScreen } from '../screens/PlanBuilderScreen';
import { ArrowLink, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function PlansSection() {
  return (
    <Section tone="paper">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="order-2 flex justify-center lg:order-1 lg:justify-start lg:pl-6">
            <Parallax range={48}>
              <PhoneFrame tilt="right" scale={0.88}>
                <PlanBuilderScreen />
              </PhoneFrame>
            </Parallax>
          </div>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">03 — Plans</Eyebrow>
              <Display className="mt-4">
                Your coach&rsquo;s plan.
                <br />
                Or yours.
              </Display>
              <Lead tone="light" className="mt-6">
                Follow a program your coach built and assigned — or build your own
                from a 650+ exercise library. Either way it lands in Train, laid
                out week by week, ready for gym mode.
              </Lead>
            </Reveal>

            <Stagger className="mt-10 grid gap-4 sm:grid-cols-2" gap={0.08} delay={120}>
              <StaggerItem>
                <div className="h-full rounded-block bg-ink p-6 text-snow shadow-ember-lg">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
                    Coach-built
                  </p>
                  <h3 className="mt-3 font-display text-2xl font-medium uppercase">
                    Assigned to you
                  </h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-dim">
                    Sets, reps and progressions written by a verified coach.
                    It appears in your Train tab the moment it&rsquo;s published.
                  </p>
                </div>
              </StaggerItem>
              <StaggerItem>
                <div className="mkt-card-light h-full rounded-block p-6">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-gravel">
                    Build your own
                  </p>
                  <h3 className="mt-3 font-display text-2xl font-medium uppercase text-ink">
                    Total control
                  </h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-gravel">
                    Drag exercises into any split — Push · Pull · Legs or something
                    stranger. Reorder with a thumb, edit mid-block.
                  </p>
                </div>
              </StaggerItem>
            </Stagger>

            <Reveal delay={260}>
              <ArrowLink href="/coaching" className="mt-9 text-red-deep">
                Meet the coaches behind the plans
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
