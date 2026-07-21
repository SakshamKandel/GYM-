'use client';

/**
 * Coach FAQ — coal band, native <details> glass rows (no JS accordion), plus
 * the "Keep exploring" cross-link row.
 */
import Link from 'next/link';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

const FAQS = [
  {
    q: 'Who gets verified?',
    a: 'Coaches who can show real coaching history. You apply in the app with your headline, specialties, certifications and years; the GM team reviews every application by hand and approves or declines it. Only verified coaches appear in the discovery hub — there is no pay-to-list.',
  },
  {
    q: 'How does capacity work?',
    a: 'You set the maximum number of clients you want to carry, and the platform enforces it. Once your roster hits the cap, new coaching requests pause automatically until a spot opens. Each member can only hold one pending request at a time, and you accept or decline every one yourself.',
  },
  {
    q: 'How do payouts work?',
    a: 'Every subscription bought with your promo code writes a dated 30% commission entry to your wallet ledger. When you want to cash out, you request a payout from the console — the request lands in the GM payout queue, gets processed by the team, and the payout is recorded as its own ledger entry.',
  },
  {
    q: 'How do tier upgrades work?',
    a: 'Every coach starts at silver on verification. When your record has grown — clients coached, milestones logged — you request gold or elite straight from your console. The GM team reviews the request against your coaching history and answers. Badges are earned and reviewed, never bought.',
  },
] as const;

const EXPLORE = [
  {
    href: '/coaching',
    title: 'Coaching, member-side',
    copy: 'What your future clients see: the discovery hub, requests and chat.',
  },
  {
    href: '/pricing',
    title: 'Pricing',
    copy: 'The tiers your clients subscribe to — and take 30% off with your code.',
  },
  {
    href: '/partners',
    title: 'Partner kitchens',
    copy: 'The other side of the marketplace: meal partners and the portal they run.',
  },
] as const;

export function FaqSection() {
  return (
    <Section tone="coal" id="faq">
      <Container>
        <Reveal>
          <Eyebrow>Straight answers</Eyebrow>
          <Display flavor="steel" size="lg" className="mt-4">
            Coach FAQ.
          </Display>
        </Reveal>

        <div className="mt-12 flex flex-col gap-3">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 80}>
              <details className="mkt-glass-deep group rounded-block px-7 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span className="text-[16.5px] font-semibold text-snow">{f.q}</span>
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-[15px] text-snow transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-dim">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>

        {/* keep exploring */}
        <Reveal delay={200}>
          <div className="mkt-divider mt-20" />
          <p className="mt-14 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-dim">
            Keep exploring
          </p>
        </Reveal>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {EXPLORE.map((e, i) => (
            <Reveal key={e.href} delay={i * 90}>
              <Link
                href={e.href}
                className="mkt-glass-deep mkt-card-hover group flex h-full min-h-[150px] flex-col justify-between rounded-block p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-[20px] font-medium uppercase leading-tight text-snow">
                    {e.title}
                  </h3>
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-[14px] text-snow transition-all duration-300 group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <p className="mt-3 text-[13.5px] leading-relaxed text-dim">{e.copy}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
