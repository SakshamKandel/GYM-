'use client';

/**
 * /partners portal tour — three alternating deep-dive sections with three
 * different presentation types: an animated glass state-pipeline, a
 * BrowserFrame console, and a bare light panel. Copy sides alternate.
 */
import { BrowserFrame } from '../PhoneFrame';
import { Reveal, useStepLoop } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';
import { EarningsMock } from './EarningsMock';
import { PrepQueueMock } from './PrepQueueMock';

/* ------------------------------------------------ 01 · live order board */

const ORDER_STATES = [
  'Placed',
  'Confirmed',
  'Preparing',
  'Ready',
  'Picked up',
  'Out for delivery',
  'Delivered',
] as const;

function StatePipeline() {
  const [ref, step] = useStepLoop(8, 950, 3);
  const active = Math.min(step, ORDER_STATES.length - 1);

  return (
    <div ref={ref} className="mkt-glass rounded-block p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-y-3.5">
        {ORDER_STATES.map((s, i) => {
          const done = i < active;
          const isActive = i === active;
          return (
            <span key={s} className="flex items-center">
              <span
                className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] transition-all duration-300 ${
                  isActive
                    ? 'bg-red font-semibold text-ink shadow-ember'
                    : done
                      ? 'bg-white/10 font-medium text-snow'
                      : 'bg-white/5 font-medium text-dim'
                }`}
              >
                {done ? '✓ ' : ''}
                {s}
              </span>
              {i < ORDER_STATES.length - 1 ? (
                <span aria-hidden className="mx-1.5 text-[11px] text-faint">
                  →
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="mkt-divider my-5" />
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
        Each advance updates the member&rsquo;s live tracker
      </p>
    </div>
  );
}

export function OrdersBoardTour() {
  return (
    <Section tone="coal">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow>Portal tour · 01</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display size="lg" flavor="steel" className="mt-4">
                One board.
                <br />
                Seven states.
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-6">
                Every order lands on the live board the moment it&rsquo;s placed. Accept it,
                advance it as you cook, hand it off — the same seven-state machine members watch
                from their phones.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>Accept or decline new orders in one tap</CheckItem>
                <CheckItem>Cash-on-delivery flagged right on the card</CheckItem>
                <CheckItem>Subscription orders appear automatically each cycle</CheckItem>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={180}>
            <StatePipeline />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* --------------------------------------- 02 · prep queue + menu manager */

export function PrepMenuTour() {
  return (
    <Section tone="ink">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="lg:order-2">
            <Reveal>
              <Eyebrow>Portal tour · 02</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display size="lg" flavor="steel" className="mt-4">
                Cook counts,
                <br />
                not tickets.
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-6">
                Before each cutoff, the portal folds every order into one prep list — dish by
                dish, with totals. Fourteen paneer bowls is one line, not fourteen tickets.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <Lead className="mt-4">
                The menu manager keeps your listings honest: name, price, macros, availability.
                Flip a dish off when it runs out and members see it instantly.
              </Lead>
            </Reveal>
          </div>
          <Reveal delay={180} className="lg:order-1">
            <div className="mx-auto w-full max-w-[460px]">
              <BrowserFrame url="gm-method.app/partner/prep">
                <PrepQueueMock />
              </BrowserFrame>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* ------------------------------------------------ 03 · earnings + payouts */

export function EarningsTour() {
  return (
    <Section tone="coal">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <Reveal>
              <Eyebrow>Portal tour · 03</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display size="lg" flavor="steel" className="mt-4">
                Your money,
                <br />
                in plain sight.
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-6">
                Every delivered order lands in your wallet ledger. Request a payout when you want
                one, and read the week ahead from the order history and subscription roster — no
                spreadsheets, no guessing.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>Wallet ledger entry per delivered order</CheckItem>
                <CheckItem>Payout requests straight from the portal</CheckItem>
                <CheckItem>Subscription roster shows recurring weekly volume</CheckItem>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={180}>
            <div
              className="mx-auto w-full max-w-[440px] rounded-2xl bg-[#f5f5f2] p-3.5 shadow-phone"
              style={{ transform: 'perspective(1600px) rotateY(6deg) rotateX(2deg)' }}
            >
              <EarningsMock />
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
