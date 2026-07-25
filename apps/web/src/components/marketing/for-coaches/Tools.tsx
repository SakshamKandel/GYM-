'use client';

/**
 * Tools tour v3 — paper-2 band. CoachMilestoneScreen in a tilted PhoneFrame
 * on scroll parallax next to the working checklist: assignments, PII-guarded
 * chat, milestones, challenges. The phone stays dark — iron inside paper.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Parallax, Reveal } from '../motion';
import { CoachMilestoneScreen } from '../screens/CoachMilestoneScreen';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function ToolsSection() {
  return (
    <Section tone="paper-2" id="tools">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[0.9fr_1.1fr]">
          {/* device */}
          <div className="order-2 flex justify-center lg:order-1 lg:justify-start lg:pl-6">
            <Parallax range={48}>
              <PhoneFrame tilt="left" scale={0.86}>
                <CoachMilestoneScreen />
              </PhoneFrame>
            </Parallax>
          </div>

          {/* copy */}
          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">The coaching toolkit</Eyebrow>
              <Display size="lg" className="mt-4">
                The console does
                <br />
                the <span className="text-red-deep">admin.</span>
              </Display>
              <Lead tone="light" className="mt-6">
                Your roster, your sign-offs, chat, plans and milestones. One console on the web and
                in the app, so a client&rsquo;s whole story is in front of you before you reply.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  Write full workout programs for clients on Silver, and diet plans for clients on
                  Gold. Build it once, and it lands in their app.
                </CheckItem>
                <CheckItem tone="light">
                  Chat with phone numbers and handles hidden both ways. Yours never reach them, and
                  theirs never reach you.
                </CheckItem>
                <CheckItem tone="light">
                  Log client milestones that publish straight to their Progress portfolio
                  and stack up on your public record.
                </CheckItem>
                <CheckItem tone="light">
                  Run challenges, sign off next-weight suggestions, and catch a client going quiet
                  before you lose them.
                </CheckItem>
              </ul>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
