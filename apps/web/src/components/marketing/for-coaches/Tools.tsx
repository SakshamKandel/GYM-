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
                Roster, review queue, chat, plans and milestones — one console on web and in
                the app, so a client&rsquo;s whole story is in front of you before you reply.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  Assign full workout programs to silver-plan clients and diet plans to
                  gold-plan clients — built once, delivered in their app.
                </CheckItem>
                <CheckItem tone="light">
                  Chat with server-side PII masking in both directions — phone numbers and
                  handles never cross the line, yours or theirs.
                </CheckItem>
                <CheckItem tone="light">
                  Log client milestones that publish straight to their Progress portfolio —
                  and stack up on your public record.
                </CheckItem>
                <CheckItem tone="light">
                  Run challenges, clear the review queue, and catch needs-attention flags
                  before a quiet client becomes a lost one.
                </CheckItem>
              </ul>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
