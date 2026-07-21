import type { Metadata } from 'next';
import Link from 'next/link';
import { Shell } from '@/components/marketing/Shell';
import { Reveal } from '@/components/marketing/motion';
import {
  ArrowLink,
  Card,
  Container,
  Display,
  Eyebrow,
  Lead,
  PillLink,
  Section,
} from '@/components/marketing/ui';

export const metadata: Metadata = {
  title: 'Support | The GM Method',
  description:
    'Get member, coach, or meal-partner help for the GM Method. Support routes through your signed-in account, so the team already has the context.',
};

const MEMBER_STEPS = [
  {
    n: '1',
    title: 'Open the app',
    body: 'On iOS or Android — the account you train with is the account we help.',
  },
  {
    n: '2',
    title: 'Settings → Support',
    body: 'Start a thread from inside your account. No login form to re-fill, no case number to memorise.',
  },
  {
    n: '3',
    title: 'Priority routing',
    body: 'Messages land attached to your plan, coaching and meal orders, so the team answers with the full picture in front of them.',
  },
] as const;

const READY = [
  'The email your account uses',
  'What you expected versus what happened',
  'A screenshot, if the screen looked wrong',
] as const;

export default function ContactPage() {
  return (
    <Shell>
      {/* Hero — compact, honest about the support model */}
      <Section
        tone="ink"
        pad="pt-[120px] pb-16 sm:pt-[140px] sm:pb-24"
        ambient="aurora"
        grid
      >
        <Container>
          <div className="max-w-3xl">
            <Reveal delay={80}>
              <Display as="h1" size="xl" className="mt-6">
                <span className="mkt-text-steel">Talk to a</span>
                <br />
                <span className="mkt-text-ember">human.</span>
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-7">
                No ticket queue, no bot maze. Help lives inside the app, attached to your account —
                so whoever picks it up already sees your plan, your coaching and your orders.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <p className="mt-8 font-mono text-[12px] uppercase tracking-[0.2em] text-faint">
                No public inbox · Support routes through your signed-in account
              </p>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Members — the primary path, on a cream reading card */}
      <Section tone="coal" pad="py-20 sm:py-28">
        <Container wide>
          <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <Reveal>
              <div className="relative overflow-hidden rounded-block bg-cream p-7 text-ink sm:p-10">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 size-52 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgb(255 59 48 / 0.14), transparent 70%)',
                  }}
                />
                <Eyebrow tone="light">Members</Eyebrow>
                <Display size="md" className="mt-4">
                  Support, inside
                  <br />
                  the app.
                </Display>
                <p className="mt-5 max-w-md text-[16px] leading-relaxed text-cream-dim">
                  Members get help without leaving the account. Three steps, no forms to lose.
                </p>
                <ol className="mt-8 flex flex-col gap-5">
                  {MEMBER_STEPS.map((s) => (
                    <li key={s.n} className="flex gap-4">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-[16px] font-medium text-cream">
                        {s.n}
                      </span>
                      <span className="pt-0.5">
                        <span className="block text-[16px] font-semibold text-ink">{s.title}</span>
                        <span className="mt-1 block text-[15px] leading-relaxed text-cream-dim">
                          {s.body}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="mt-9">
                  <ArrowLink href="/privacy" className="text-red-deep">
                    Review your privacy controls
                  </ArrowLink>
                </div>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <Card raised className="flex h-full flex-col justify-between">
                <div>
                  <Eyebrow>Before you write</Eyebrow>
                  <p className="mt-4 text-[16px] leading-relaxed text-snow">
                    A good first message saves a reply. Have these ready and the team can move
                    straight to the fix.
                  </p>
                  <ul className="mt-7 flex flex-col gap-3.5">
                    {READY.map((item) => (
                      <li key={item} className="flex items-start gap-3 text-[15px] text-dim">
                        <span
                          aria-hidden
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-red shadow-ember"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.16em] text-faint">
                  Your logs stay attached · Nothing to re-explain
                </p>
              </Card>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Partners & coaches — direct routes into their own worlds */}
      <Section tone="ink" pad="py-20 sm:py-28">
        <Container wide>
          <Reveal>
            <Eyebrow>Working with us</Eyebrow>
            <Display size="lg" flavor="steel" className="mt-4">
              Partner or coach?
            </Display>
            <Lead className="mt-6">
              Meal partners and coaches have their own consoles, their own support, and their own
              way in. Pick your lane.
            </Lead>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <Reveal delay={100}>
              <Card hover className="flex h-full flex-col">
                <span className="font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-red-glow">
                  Meal partners
                </span>
                <h2 className="mt-4 font-display text-[26px] font-medium uppercase leading-tight text-snow">
                  Cook with the app
                </h2>
                <p className="mt-4 flex-1 text-[15px] leading-relaxed text-dim">
                  Run live orders, menu availability, subscriptions and payouts from an isolated
                  partner portal. New kitchen? Start with the pitch.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <PillLink href="/partners" variant="ghost" small>
                    Partner with us
                  </PillLink>
                  <ArrowLink href="/partner/login" className="text-snow">
                    Open partner portal
                  </ArrowLink>
                </div>
              </Card>
            </Reveal>

            <Reveal delay={180}>
              <Card hover className="flex h-full flex-col">
                <span className="font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-red-glow">
                  Coaches
                </span>
                <h2 className="mt-4 font-display text-[26px] font-medium uppercase leading-tight text-snow">
                  Coach on the platform
                </h2>
                <p className="mt-4 flex-1 text-[15px] leading-relaxed text-dim">
                  Program training, build diet plans and message assigned members from the coach
                  console — with everyone&rsquo;s personal details masked. Apply to join.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <PillLink href="/for-coaches" variant="ghost" small>
                    Coach with us
                  </PillLink>
                  <ArrowLink href="/coach/login" className="text-snow">
                    Open coach console
                  </ArrowLink>
                </div>
              </Card>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Portals strip — every signed-in door in one place */}
      <Section tone="coal" pad="py-16 sm:py-20">
        <Container wide>
          <Reveal>
            <Card className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Eyebrow>Portals</Eyebrow>
                <p className="mt-3 max-w-md text-[16px] leading-relaxed text-snow">
                  Already have a staff, coach or partner account? Sign in where you belong.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <PillLink href="/coach/login" variant="ghost" small>
                  Coach portal
                </PillLink>
                <PillLink href="/partner/login" variant="ghost" small>
                  Partner portal
                </PillLink>
                <PillLink href="/admin/login" variant="ghost" small>
                  Admin
                </PillLink>
              </div>
            </Card>
          </Reveal>
        </Container>
      </Section>

      {/* Closing CTA — the page's single red moment */}
      <Section tone="red" pad="py-20 sm:py-28" ambient="none">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
            <Reveal>
              <Eyebrow tone="red">Not a member yet?</Eyebrow>
              <Display size="lg" className="mt-4 text-ink">
                Start, then
                <br />
                ask anything.
              </Display>
            </Reveal>
            <Reveal delay={120} className="flex flex-wrap gap-3">
              <PillLink href="/download" variant="inkOnRed">
                Get the app
              </PillLink>
              <Link
                href="/pricing"
                className="inline-flex h-14 items-center justify-center rounded-full px-8 font-sans text-[15px] font-semibold text-ink inset-ring inset-ring-ink/30 transition-colors duration-200 hover:bg-ink/10 active:scale-[0.97]"
              >
                See pricing
              </Link>
            </Reveal>
          </div>
        </Container>
      </Section>
    </Shell>
  );
}
