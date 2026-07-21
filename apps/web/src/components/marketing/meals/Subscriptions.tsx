'use client';

/**
 * Weekly subscriptions v3 — paper-2 band with the subscription management
 * screen drifting on scroll parallax. Copy stays: set the week, skip days,
 * prepaid digital cycles or COD.
 */
import { PhoneFrame } from '../PhoneFrame';
import { Parallax, Reveal } from '../motion';
import { MealSubscriptionScreen } from '../screens/MealSubscriptionScreen';
import { ArrowLink, CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

export function Subscriptions() {
  return (
    <Section tone="paper-2">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 flex justify-center lg:order-1">
            <Parallax range={48}>
              <PhoneFrame tilt="right" scale={0.88}>
                <MealSubscriptionScreen />
              </PhoneFrame>
            </Parallax>
          </div>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">Weekly subscriptions</Eyebrow>
              <Display className="mt-4">
                Set the week.
                <br />
                Skip the days.
              </Display>
              <Lead tone="light" className="mt-6">
                Subscribe Monday to Friday and the kitchen plans around you. Prepaid cycles
                run on eSewa or Khalti; skip a day from the plan screen and nothing is
                wasted — no calls, no awkward messages.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  Pause the plan or skip any day, straight from the app
                </CheckItem>
                <CheckItem tone="light">
                  Prepaid digital cycles — pay a cycle ahead on eSewa or Khalti
                </CheckItem>
                <CheckItem tone="light">
                  Prefer cash? COD orders reconcile when the meal arrives
                </CheckItem>
                <CheckItem tone="light">
                  Each delivery runs through the same live 7-state tracker
                </CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/download" className="mt-8 text-red-deep">
                Get the app to subscribe
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
