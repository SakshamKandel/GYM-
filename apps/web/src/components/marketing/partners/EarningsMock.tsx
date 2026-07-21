'use client';

/**
 * Partner-portal mock: wallet + payouts — balance stat, a week of delivered-
 * order revenue bars, a payout request button and the payout ledger. Light
 * console look; renders white cards on the parent's #f5f5f2 panel.
 */
import { useInView } from '../motion';

const BARS = [
  { day: 'M', pct: 42 },
  { day: 'T', pct: 58 },
  { day: 'W', pct: 38 },
  { day: 'T', pct: 66 },
  { day: 'F', pct: 54 },
  { day: 'S', pct: 88 },
  { day: 'S', pct: 47 },
] as const;

export function EarningsMock() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <div ref={ref} className="space-y-2.5">
      {/* Wallet card */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-[#e7e6e1]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5f636a]">
              Wallet balance
            </p>
            <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-[#1b1c1e]">
              Rs 42,650
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-[#f0521e] px-3.5 py-2 text-[10.5px] font-bold text-white">
            Request payout
          </span>
        </div>

        {/* Weekly delivered-order bars */}
        <div className="mt-4 flex h-[64px] items-end gap-1.5">
          {BARS.map((b, i) => (
            <div key={`${b.day}-${i}`} className="flex h-full flex-1 flex-col justify-end gap-1">
              <div
                className={`w-full rounded-t-[4px] transition-[height] duration-700 ease-out ${
                  b.pct >= 80 ? 'bg-[#f0521e]' : 'bg-[#f3cdbd]'
                }`}
                style={{ height: inView ? `${b.pct}%` : '4%', transitionDelay: `${i * 90}ms` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {BARS.map((b, i) => (
            <span key={`${b.day}-l-${i}`} className="flex-1 text-center text-[8.5px] font-semibold text-[#9a9ea6]">
              {b.day}
            </span>
          ))}
        </div>
      </div>

      {/* Payout ledger card */}
      <div className="rounded-xl bg-white p-3.5 ring-1 ring-[#e7e6e1]">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#5f636a]">Payouts</p>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#f5f5f2] px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-[#eab308]" />
              <span className="truncate text-[10.5px] font-semibold text-[#1b1c1e]">
                Requested · Jul 20
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-medium text-[#5f636a]">Rs 12,400 · review</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#f5f5f2] px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-[#17a34a]" />
              <span className="truncate text-[10.5px] font-semibold text-[#1b1c1e]">
                Paid · Jul 14
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-medium text-[#5f636a]">Rs 18,200 · eSewa</span>
          </div>
        </div>
      </div>
    </div>
  );
}
