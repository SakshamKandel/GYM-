'use client';

/**
 * Partner-portal mock: the live order board — 3 columns (New / In kitchen /
 * Out for delivery) mirroring the real console's light-SaaS look. One order
 * card advances across the columns on a loop. Console hex palette is
 * sanctioned for console mocks (SPEC — bg #f5f5f2, cards #fff, accent #f0521e).
 */
import type { ReactNode } from 'react';
import { useStepLoop } from '../motion';

type Pay = 'COD' | 'Prepaid';

function PayChip({ pay }: { pay: Pay }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ${
        pay === 'COD' ? 'bg-[#fdece5] text-[#c2410c]' : 'bg-[#eef1f4] text-[#5f636a]'
      }`}
    >
      {pay}
    </span>
  );
}

function OrderCard({
  code,
  items,
  pay,
  highlight = false,
  footer,
}: {
  code: string;
  items: readonly string[];
  pay: Pay;
  highlight?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`rounded-[10px] bg-white p-2 shadow-[0_1px_2px_rgb(0_0_0/0.05)] ${
        highlight ? 'ring-2 ring-[#f0521e]' : 'ring-1 ring-[#e7e6e1]'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-bold tracking-tight text-[#1b1c1e]">{code}</span>
        <PayChip pay={pay} />
      </div>
      <div className="mt-1 space-y-0.5">
        {items.map((it) => (
          <p key={it} className="truncate text-[9.5px] leading-tight text-[#5f636a]">
            {it}
          </p>
        ))}
      </div>
      {footer}
    </div>
  );
}

const COLUMNS = [
  {
    title: 'New',
    cards: [
      {
        code: '#M-2493',
        items: ['Chicken quinoa plate × 1', 'Peanut oat smoothie × 1'],
        pay: 'Prepaid' as Pay,
      },
    ],
  },
  {
    title: 'In kitchen',
    cards: [
      { code: '#M-2487', items: ['Veg power thali × 2'], pay: 'Prepaid' as Pay },
    ],
  },
  {
    title: 'Out',
    cards: [
      { code: '#M-2481', items: ['Paneer power bowl × 2'], pay: 'COD' as Pay },
    ],
  },
] as const;

const MOVER = {
  code: '#M-2489',
  items: ['Paneer power bowl × 1', 'Lemon iced tea × 1'],
  pay: 'COD' as Pay,
};

const MOVER_FOOTERS = [
  <div key="accept" className="mt-1.5 rounded-md bg-[#f0521e] py-1 text-center text-[9px] font-bold text-white">
    Accept order
  </div>,
  <div key="prep" className="mt-1.5 rounded-md bg-[#fdece5] py-1 text-center text-[9px] font-bold text-[#c2410c]">
    Preparing…
  </div>,
  <div key="out" className="mt-1.5 rounded-md bg-[#eef1f4] py-1 text-center text-[9px] font-bold text-[#5f636a]">
    Out for delivery
  </div>,
  <div key="done" className="mt-1.5 rounded-md bg-[#e8f7ee] py-1 text-center text-[9px] font-bold text-[#17a34a]">
    Delivered ✓
  </div>,
] as const;

export function LiveOrdersMock() {
  const [ref, step] = useStepLoop(4, 1700, 1);
  const moverCol = Math.min(step, 2);

  return (
    <div ref={ref} className="p-3.5 sm:p-4">
      {/* Board header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-[#1b1c1e]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#17a34a] opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-[#17a34a]" />
          </span>
          Live orders
        </span>
        <span className="text-[10px] font-medium text-[#5f636a]">Mon 21 Jul · Lunch service</span>
      </div>

      {/* 3-column board */}
      <div className="grid grid-cols-3 gap-2">
        {COLUMNS.map((col, i) => {
          const hasMover = moverCol === i;
          return (
            <div key={col.title} className="flex min-h-[172px] flex-col gap-1.5 rounded-xl bg-[#ecece7] p-1.5">
              <div className="flex items-center justify-between px-1 pt-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#5f636a]">
                  {col.title}
                </span>
                <span className="flex size-4 items-center justify-center rounded-full bg-white text-[8.5px] font-bold text-[#1b1c1e]">
                  {col.cards.length + (hasMover ? 1 : 0)}
                </span>
              </div>
              {col.cards.map((c) => (
                <OrderCard key={c.code} code={c.code} items={c.items} pay={c.pay} />
              ))}
              {hasMover ? (
                <OrderCard
                  code={MOVER.code}
                  items={MOVER.items}
                  pay={MOVER.pay}
                  highlight
                  footer={MOVER_FOOTERS[step]}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
