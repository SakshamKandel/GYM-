'use client';

/**
 * Mock: Gym Mode rest timer — big Oswald countdown inside a red ring that
 * live-ticks (90 s loop), next-set context, plate-math strip.
 */
import { useEffect, useState } from 'react';
import { useInView, useReducedMotion } from '../motion';
import {
  AppEyebrow,
  AppScreen,
  AppTabBar,
  BlockCard,
  MetaChip,
  MiniRing,
} from './appkit';

const TOTAL = 90;

export function RestTimerScreen() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const reduced = useReducedMotion();
  const [left, setLeft] = useState(64);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = setInterval(() => setLeft((s) => (s <= 1 ? TOTAL : s - 1)), 1000);
    return () => clearInterval(id);
  }, [inView, reduced]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col px-5 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <AppEyebrow>Gym mode</AppEyebrow>
            <h3 className="font-display text-[26px] font-medium uppercase leading-none">Rest</h3>
          </div>
          <MetaChip>Set 3 of 4</MetaChip>
        </div>

        {/* Countdown ring */}
        <div className="mt-7 flex justify-center">
          <MiniRing size={216} stroke={13} pct={(left / TOTAL) * 100} track="#1D1F22">
            <div className="text-center">
              <span className="font-display text-[64px] font-medium leading-none tabular-nums">
                {mm}:{ss}
              </span>
              <p className="mt-1 font-display text-[11px] uppercase tracking-[0.2em] text-dim">
                Rest remaining
              </p>
            </div>
          </MiniRing>
        </div>

        <div className="mt-6 flex justify-center gap-2.5">
          <span className="flex h-[42px] items-center rounded-full bg-charcoal-2 px-5 text-[13px] font-semibold">
            +15 s
          </span>
          <span className="flex h-[42px] items-center rounded-full bg-red px-5 text-[13px] font-semibold text-ink">
            Skip rest
          </span>
        </div>

        {/* Next up */}
        <BlockCard tone="charcoal" className="mt-6">
          <AppEyebrow>Next up</AppEyebrow>
          <p className="mt-1 text-[15px] font-semibold">Incline DB Press</p>
          <p className="text-[12px] text-dim">Target 3 × 10 · last time 26 kg × 10</p>
        </BlockCard>

        {/* Plate math strip */}
        <BlockCard tone="cream" className="mt-2.5 py-3.5">
          <AppEyebrow onBlock>Plate calculator · 72.5 kg bar</AppEyebrow>
          <div className="mt-2 flex items-center gap-1.5">
            {['20', '5', '1.25'].map((p) => (
              <span
                key={p}
                className="flex h-8 items-center rounded-md bg-ink px-2.5 font-display text-[13px] font-medium text-snow"
              >
                {p}
              </span>
            ))}
            <span className="ml-1 text-[12px] font-semibold text-cream-dim">per side</span>
          </div>
        </BlockCard>
      </div>
      <AppTabBar active="train" />
    </AppScreen>
  );
}
