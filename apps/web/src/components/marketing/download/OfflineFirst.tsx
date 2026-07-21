'use client';

/**
 * Offline-first explainer — copy beside a hand-built line-art SVG: a basement
 * gym, a dumbbell, and a phone that logs a set with the signal bars crossed
 * out. The site's ONE red section lives elsewhere; here red is an accent.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, Section } from '../ui';

function BasementScene() {
  return (
    <svg
      viewBox="0 0 440 340"
      role="img"
      aria-label="A phone logging a workout set in a basement gym with no signal"
      className="w-full"
    >
      {/* ceiling + a slice of stairs, back wall */}
      <path d="M40 46h360" stroke="#3b3e44" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M300 46v18h34v18h34"
        stroke="#2e3135"
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* small basement window, high on the wall */}
      <rect x="66" y="60" width="58" height="34" rx="3" stroke="#3b3e44" strokeWidth="2" fill="none" />
      <path d="M95 60v34M66 77h58" stroke="#2e3135" strokeWidth="1.5" />
      {/* floor */}
      <path d="M24 300h392" stroke="#3b3e44" strokeWidth="2" strokeLinecap="round" />

      {/* dumbbell on the floor, left */}
      <g stroke="#63676e" strokeWidth="2" strokeLinecap="round" fill="#131416">
        <rect x="70" y="256" width="18" height="34" rx="4" />
        <rect x="86" y="266" width="10" height="14" rx="3" />
        <rect x="96" y="270" width="44" height="6" rx="3" fill="#63676e" stroke="none" />
        <rect x="140" y="266" width="10" height="14" rx="3" />
        <rect x="148" y="256" width="18" height="34" rx="4" />
      </g>

      {/* phone, right — the set is logging */}
      <g>
        <rect x="242" y="110" width="150" height="182" rx="20" fill="#0b0c0d" stroke="#3b3e44" strokeWidth="2" />
        <rect x="252" y="120" width="130" height="162" rx="13" fill="#131416" />
        {/* no-signal badge */}
        <g transform="translate(262 134)">
          <rect x="0" y="10" width="4" height="5" rx="1" fill="#63676e" />
          <rect x="6" y="7" width="4" height="8" rx="1" fill="#63676e" />
          <rect x="12" y="3.5" width="4" height="11.5" rx="1" fill="#3b3e44" />
          <rect x="18" y="0" width="4" height="15" rx="1" fill="#3b3e44" />
          <path d="M-2 17 24 -1" stroke="#ff3b30" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <text x="300" y="148" fill="#9ba0a8" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="1.5">
          NO SIGNAL
        </text>
        {/* logged set row */}
        <rect x="262" y="164" width="110" height="42" rx="10" fill="#1d1f22" />
        <circle cx="282" cy="185" r="11" fill="#ff3b30" />
        <path d="M277 185.5l3.5 3.5 6-7" stroke="#0b0c0d" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="300" y="182" fill="#f5f6f7" fontFamily="var(--font-sans)" fontSize="9.5" fontWeight="600">
          Bench 4 × 8
        </text>
        <text x="300" y="195" fill="#9ba0a8" fontFamily="var(--font-sans)" fontSize="8.5">
          72.5 kg · logged
        </text>
        {/* saved-locally chip */}
        <rect x="262" y="216" width="110" height="26" rx="8" fill="#1d1f22" />
        <circle cx="277" cy="229" r="4" fill="#34c759" className="animate-pulse" />
        <text x="288" y="232.5" fill="#9ba0a8" fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1">
          SAVED ON DEVICE
        </text>
      </g>
    </svg>
  );
}

export function OfflineFirst() {
  return (
    <Section tone="coal">
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Offline-first</Eyebrow>
            <Display size="lg" className="mt-4">
              No signal?<br />
              Keep <span className="mkt-text-ember">lifting.</span>
            </Display>
            <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
              Basement gyms, thick concrete, dead zones near the squat rack — none of it
              matters. Every set writes to your phone first and confirms in under 100&nbsp;
              milliseconds. When signal comes back, it syncs quietly in the background.
            </p>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-dim">
              You never watch a spinner between sets. The app was built for the room you
              actually train in, not the demo on stage.
            </p>
          </Reveal>

          <Reveal delay={140}>
            <div className="mkt-glass rounded-block p-6 sm:p-8">
              <BasementScene />
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
