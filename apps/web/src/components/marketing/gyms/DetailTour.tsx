'use client';

/**
 * Detail-page tour (coal) — copy left, tilted device right with the gym
 * detail screen. Second (and last) full device on the page.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Reveal } from '../motion';
import { GymDetailScreen } from '../screens/GymDetailScreen';
import { ArrowLink, CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function DetailTour() {
  return (
    <Section tone="coal">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow>01 — The detail page</Eyebrow>
              <Display flavor="steel" className="mt-4">
                The full picture,
                <br />
                before you visit.
              </Display>
              <Lead className="mt-6">
                Tap any listing and the whole gym opens up — a real photo gallery,
                day-by-day hours, amenities and contact, with an exact pin and one-tap
                directions. No guessing what&rsquo;s behind the door.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>
                  Photo galleries of the actual floor — the racks, the machines, the room
                  you&rsquo;ll train in
                </CheckItem>
                <CheckItem>Opening hours for every day of the week, kept current by the GM team</CheckItem>
                <CheckItem>Amenities, phone number and exact location — call or navigate in one tap</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/download" className="mt-8 text-red">
                Browse gyms in the app
              </ArrowLink>
            </Reveal>
          </div>
          <Reveal delay={100} className="flex justify-center">
            <PhoneFrame tilt="right" scale={0.88}>
              <GymDetailScreen />
            </PhoneFrame>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
