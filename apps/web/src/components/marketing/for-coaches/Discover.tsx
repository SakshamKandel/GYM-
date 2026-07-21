'use client';

/**
 * Get-discovered section v3 — paper band. The coach's public discovery-hub
 * card rebuilt as a white hairline card (site language, not a phone screen)
 * next to copy about the profile fields coaches control and capacity-gated
 * requests.
 */
import { Parallax, Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Hairline, Lead, Section } from '../ui';

const SPECIALTIES = ['Strength', 'Fat loss', 'Powerlifting'] as const;

const MILESTONES = [
  { title: 'First 100 kg squat — Anisha S.', when: 'Jul 21' },
  { title: '−6 kg cut in 10 weeks — Bibek R.', when: 'May 18' },
] as const;

function CoachProfileCard() {
  return (
    <div className="mkt-card-light rounded-block p-7" aria-hidden>
      {/* identity row */}
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-red font-display text-[22px] font-medium text-ink shadow-ember">
          G
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold text-ink">Gaurav M.</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-gold">
              Gold coach
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-gravel">
            Strength &amp; fat-loss coach · 8 yrs
          </p>
        </div>
      </div>

      {/* specialties */}
      <div className="mt-5 flex flex-wrap gap-2">
        {SPECIALTIES.map((s) => (
          <span
            key={s}
            className="rounded-full border border-mist-strong px-3 py-1.5 text-[11.5px] font-medium text-ink"
          >
            {s}
          </span>
        ))}
        <span className="rounded-full border border-mist-strong px-3 py-1.5 text-[11.5px] font-medium text-gravel">
          NSCA-certified
        </span>
      </div>

      <Hairline className="my-5" />

      {/* client milestones — the public record */}
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-gravel">
        Client milestones
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {MILESTONES.map((m) => (
          <div
            key={m.title}
            className="flex items-center gap-2.5 rounded-inner bg-paper-2 px-3.5 py-2.5"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red text-[10px] font-bold text-ink">
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
              {m.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase text-gravel-faint">
              {m.when}
            </span>
          </div>
        ))}
      </div>

      {/* capacity + request */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gravel">Capacity</p>
          <p className="mt-0.5 font-display text-[19px] font-medium text-ink">
            14<span className="text-gravel-faint"> / 20</span>
          </p>
        </div>
        <span className="inline-flex h-11 items-center justify-center rounded-full bg-red px-6 text-[13.5px] font-semibold text-ink shadow-ember">
          Request coaching
        </span>
      </div>
    </div>
  );
}

export function DiscoverSection() {
  return (
    <Section tone="paper" id="discover">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          {/* copy */}
          <div>
            <Reveal>
              <Eyebrow tone="light">Get discovered</Eyebrow>
              <Display size="lg" className="mt-4">
                Members find you.
                <br />
                Not the other way.
              </Display>
              <Lead tone="light" className="mt-6">
                Verification puts you in the discovery hub every member scrolls when they want
                a real coach. Your card is yours to shape — and your logged client milestones
                do the bragging for you.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">
                  Photo, headline, specialties, certifications, achievements and years — every
                  field on your public profile is yours to edit.
                </CheckItem>
                <CheckItem tone="light">
                  Capacity-gated: you set your client cap, and new requests pause automatically
                  the moment you hit it.
                </CheckItem>
                <CheckItem tone="light">
                  You accept or decline every request — and each member can only have one
                  pending request at a time, so your inbox stays sane.
                </CheckItem>
                <CheckItem tone="light">
                  Milestones you log for clients publish to their Progress portfolio and build
                  your public track record.
                </CheckItem>
              </ul>
            </Reveal>
          </div>

          {/* discovery card mock */}
          <Reveal delay={160}>
            <Parallax range={32}>
              <div className="mx-auto w-full max-w-[440px]">
                <CoachProfileCard />
                <p className="mt-4 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-gravel-faint">
                  Your card in the member discovery hub
                </p>
              </div>
            </Parallax>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
