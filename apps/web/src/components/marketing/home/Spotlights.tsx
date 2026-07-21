'use client';

/**
 * Home spotlights v3 — feature deep dives using interactive mobile phone replicas
 * aligned with the Expo mobile app screens and design tokens.
 */
import { InteractivePhone } from '../InteractivePhone';
import { Parallax, Reveal } from '../motion';
import { CoachChatScreen } from '../screens/CoachChatScreen';
import { TrendChartCard } from '../screens/TrendChartCard';
import {
  ArrowLink,
  CheckItem,
  Container,
  Display,
  Eyebrow,
  Lead,
  PillLink,
  Section,
} from '../ui';

export function TrainingSpotlight() {
  return (
    <Section tone="paper" pad="py-24 sm:py-28">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 flex justify-center lg:order-1">
            <Parallax range={48}>
              <InteractivePhone activeTab="train" tilt="left" scale={0.88} />
            </Parallax>
          </div>
          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">01 — Training</Eyebrow>
              <Display className="mt-4">
                Lift. Log.
                <br />
                Get out.
              </Display>
              <Lead tone="light" className="mt-6">
                Gym mode carries you set to set: a rest timer that starts itself, plate math
                done for you, and last session&rsquo;s numbers right where you need them.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">Coach-built plans or your own — 650+ exercises</CheckItem>
                <CheckItem tone="light">True-3D muscle anatomy with 17 heat-mapped zones</CheckItem>
                <CheckItem tone="light">Automatic PR detection, tested to the rep</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/training" className="mt-8 text-red-deep">
                Explore training
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function FoodSpotlight() {
  return (
    <Section tone="paper-2" pad="py-24 sm:py-28">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="light">02 — Food</Eyebrow>
              <Display className="mt-4">
                Eat like
                <br />
                it counts.
              </Display>
              <Lead tone="light" className="mt-6">
                Scan a barcode or search dal bhat — the app speaks Nepali kitchens and global
                databases alike. Macros, water and food quality, minus the spreadsheet feeling.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">Open Food Facts + USDA search, plus custom foods</CheckItem>
                <CheckItem tone="light">Nutri-Score, fiber, sugar and sodium at a glance</CheckItem>
                <CheckItem tone="light">Targets computed from your onboarding, not guesses</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/nutrition" className="mt-8 text-red-deep">
                Explore food
              </ArrowLink>
            </Reveal>
          </div>
          <div className="flex justify-center">
            <Parallax range={48}>
              <InteractivePhone activeTab="food" tilt="up" scale={0.88} />
            </Parallax>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function MealsSpotlight() {
  return (
    <Section tone="paper" pad="py-24 sm:py-28">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 flex justify-center lg:order-1">
            <Parallax range={48}>
              <InteractivePhone activeTab="meals" tilt="right" scale={0.88} />
            </Parallax>
          </div>
          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">03 — Meals</Eyebrow>
              <Display className="mt-4">
                Protein,
                <br />
                delivered.
              </Display>
              <Lead tone="light" className="mt-6">
                Macro-counted meals from vetted partner kitchens across Kathmandu valley —
                one-off orders or weekly subscriptions, cash on delivery or digital. Every
                order tracked live through seven states.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">Meals logged to your food diary automatically</CheckItem>
                <CheckItem tone="light">Member discounts at partner restaurants with your card</CheckItem>
                <CheckItem tone="light">Order cutoffs tuned to Kathmandu kitchen hours</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200}>
              <ArrowLink href="/meals" className="mt-8 text-red-deep">
                Explore meals
              </ArrowLink>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export function ProgressSpotlight() {
  return (
    <Section tone="paper-2" pad="py-24 sm:py-28">
      <Container wide>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <Reveal>
              <Eyebrow tone="light">04 — Progress</Eyebrow>
              <Display className="mt-4">
                The trend,
                <br />
                not the noise.
              </Display>
              <Lead tone="light" className="mt-6">
                Daily weight jumps around — your trend doesn&rsquo;t. Exponential smoothing
                turns scale chaos into a line you can actually believe, next to PRs,
                measurements and streaks.
              </Lead>
            </Reveal>
            <Reveal delay={160}>
              <ArrowLink href="/progress" className="mt-8 text-red-deep">
                Explore progress
              </ArrowLink>
            </Reveal>
          </div>
          <Reveal delay={100}>
            <Parallax range={36}>
              <TrendChartCard />
            </Parallax>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

export function CoachingSpotlight() {
  return (
    <Section tone="red" id="coaching">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="red">05 — Coaching</Eyebrow>
              <Display className="mt-4">
                A real human
                <br />
                in your corner.
              </Display>
              <Lead tone="red" className="mt-6">
                Verified coaches with public track records. They program your training, build
                your diet plan and answer in chat — while the app keeps everyone&rsquo;s
                personal details masked and safe.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="red">Browse coach profiles, milestones and specialties</CheckItem>
                <CheckItem tone="red">Silver, Gold and Elite mentorship levels</CheckItem>
                <CheckItem tone="red">Coach-logged milestones build your portfolio</CheckItem>
              </ul>
            </Reveal>
            <Reveal delay={200} className="mt-9">
              <PillLink href="/coaching" variant="inkOnRed">
                Meet the coaches
              </PillLink>
            </Reveal>
          </div>
          <div className="flex justify-center">
            <Parallax range={48}>
              <InteractivePhone activeTab="home" tilt="left" scale={0.88} />
            </Parallax>
          </div>
        </div>
      </Container>
    </Section>
  );
}
