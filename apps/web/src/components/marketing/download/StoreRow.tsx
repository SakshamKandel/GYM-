'use client';

/**
 * Store row — the App Store / Google Play listings are still being finalized,
 * so these render as honest "soon" plates (not fake links). Early access is the
 * real door, via /contact.
 */
import type { ReactNode } from 'react';
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PillLink, Section } from '../ui';

function StorePlate({
  store,
  glyph,
}: {
  store: string;
  glyph: ReactNode;
}) {
  return (
    <div className="mkt-glass-deep flex items-center gap-4 rounded-block px-6 py-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/6 text-snow">
        {glyph}
      </span>
      <span className="flex-1">
        <span className="block font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">
          Coming to the
        </span>
        <span className="block font-display text-[22px] font-medium uppercase leading-tight text-snow">
          {store}
        </span>
      </span>
      <span className="rounded-full border border-line-strong px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">
        Soon
      </span>
    </div>
  );
}

export function StoreRow() {
  return (
    <Section tone="coal">
      <Container wide>
        <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <Eyebrow>Launching soon</Eyebrow>
            <Display size="md" className="mt-4">
              Store listings are<br />
              nearly ready.
            </Display>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-dim">
              We&rsquo;re finishing store review for iOS and Android. Join early access and
              we&rsquo;ll send you a build the day it&rsquo;s live — no waiting in a queue.
            </p>
            <div className="mt-8">
              <PillLink href="/contact">Get early access</PillLink>
            </div>
          </Reveal>

          <Reveal delay={120} className="flex flex-col gap-4">
            <StorePlate
              store="App Store"
              glyph={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M16.5 1.6c.1 1-.3 2-1 2.8-.7.8-1.7 1.4-2.7 1.3-.1-1 .4-2 1-2.7.7-.8 1.8-1.4 2.7-1.4ZM19 17.3c-.5 1.1-.7 1.6-1.3 2.6-.9 1.4-2.1 3.1-3.6 3.1-1.3 0-1.7-.9-3.5-.9s-2.2.8-3.5.9c-1.5 0-2.6-1.5-3.5-2.9-2.5-3.8-2.7-8.3-1.2-10.7 1-1.7 2.7-2.7 4.3-2.7 1.6 0 2.6 1 3.9 1 1.3 0 2-1 3.9-1 1.4 0 2.9.8 3.9 2.1-3.4 1.9-2.9 6.8.3 8.4Z" />
                </svg>
              }
            />
            <StorePlate
              store="Google Play"
              glyph={
                <svg width="22" height="24" viewBox="0 0 24 26" fill="currentColor" aria-hidden>
                  <path d="M3.6 1.3a1.7 1.7 0 0 0-.6 1.3v20.8c0 .5.2 1 .6 1.3L15 13 3.6 1.3Zm12.7 10.4 3.1-1.8c1.3-.7 1.3-2.6 0-3.3L16 4.8l-3.4 3.4 3.7 3.5Zm-3.7 4.9L16 20.2l3.4-1.9c1.3-.7 1.3-2.6 0-3.3l-3.1-1.8-3.7 3.4Z" />
                </svg>
              }
            />
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
              No fake links — these go live at launch, not before.
            </p>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
