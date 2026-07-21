'use client';

/**
 * Progress photos — the page's single red band. Privacy stance front and
 * center, with an ink "vault" card showing signed, private delivery.
 */
import { Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const WEEKS = ['WK 04', 'WK 08', 'WK 12'] as const;

function LockGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Zm3 5.2a1.6 1.6 0 0 0-.8 3v1.3a.8.8 0 0 0 1.6 0v-1.3a1.6 1.6 0 0 0-.8-3Z" />
    </svg>
  );
}

export function PhotosSection() {
  return (
    <Section tone="red" ambient="none">
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_0.95fr]">
          <div>
            <Reveal>
              <Eyebrow tone="red">04 — Progress photos</Eyebrow>
              <Display className="mt-4">
                Your photos.
                <br />
                Yours only.
              </Display>
              <Lead tone="red" className="mt-6">
                Progress photos are the most personal data in fitness, so we treat them like
                it. They&rsquo;re stored privately and delivered only through signed,
                authenticated URLs — no public feed, no gallery, no community tab. You took
                them; you decide who sees them.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="red">Private by default — never published anywhere</CheckItem>
                <CheckItem tone="red">
                  Signed Cloudinary delivery: no valid signature, no image
                </CheckItem>
                <CheckItem tone="red">
                  Filed by date beside your trend and tape, so change is undeniable
                </CheckItem>
              </ul>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <div className="rounded-block bg-ink p-6 shadow-pop sm:p-7">
              <div className="flex items-center justify-between gap-3 text-dim">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em]">
                  Progress photos · private storage
                </p>
                <LockGlyph />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {WEEKS.map((wk, i) => (
                  <div
                    key={wk}
                    className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 overflow-hidden rounded-inner"
                    style={{
                      background: `linear-gradient(${155 + i * 15}deg, #26282C 0%, #1D1F22 55%, #131416 100%)`,
                    }}
                  >
                    <span className="text-faint">
                      <LockGlyph />
                    </span>
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
                      {wk}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-full bg-charcoal px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">
                  res.cloudinary.com/…/authenticated/s--x7Kq…--/wk-12.jpg
                </span>
                <span className="shrink-0 rounded-full bg-mint/15 px-2.5 py-1 font-mono text-[10.5px] font-medium text-mint">
                  signed ✓
                </span>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-dim">
                Every request carries a signature. Strip it, share it, guess it — the image
                simply doesn&rsquo;t load.
              </p>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
