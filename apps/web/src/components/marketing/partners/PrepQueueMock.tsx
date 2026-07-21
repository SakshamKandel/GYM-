'use client';

/**
 * Partner-portal mock: the prep queue — orders folded into aggregated dish
 * counts before a cutoff, plus a slice of the menu manager (availability
 * toggles). Light console look, sanctioned hex palette.
 */
import { useInView } from '../motion';

const ROWS = [
  { dish: 'Paneer power bowl', count: 14, done: 9 },
  { dish: 'Chicken quinoa plate', count: 9, done: 7 },
  { dish: 'Veg power thali', count: 7, done: 3 },
  { dish: 'Peanut oat smoothie', count: 5, done: 5 },
] as const;

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-flex h-4 w-7 shrink-0 rounded-full ${
        on ? 'bg-[#f0521e]' : 'bg-[#d8d7d2]'
      }`}
    >
      <span
        className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm ${on ? 'left-3.5' : 'left-0.5'}`}
      />
    </span>
  );
}

export function PrepQueueMock() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <div ref={ref} className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-[#1b1c1e]">Prep queue</span>
        <span className="rounded-full bg-[#fdece5] px-2.5 py-1 text-[9.5px] font-bold text-[#c2410c]">
          Lunch cutoff 10:30
        </span>
      </div>
      <p className="mt-1 text-[10px] font-medium text-[#5f636a]">35 dishes across 19 orders</p>

      {/* Aggregated dish rows */}
      <div className="mt-3 space-y-2">
        {ROWS.map((r, i) => {
          const pct = Math.round((r.done / r.count) * 100);
          const full = r.done === r.count;
          return (
            <div key={r.dish} className="rounded-xl bg-white p-2.5 ring-1 ring-[#e7e6e1]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-[#1b1c1e]">
                  {r.dish} <span className="font-bold text-[#f0521e]">× {r.count}</span>
                </span>
                <span className={`text-[9.5px] font-semibold ${full ? 'text-[#17a34a]' : 'text-[#5f636a]'}`}>
                  {full ? 'Done ✓' : `${r.done} of ${r.count}`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#ecece7]">
                <div
                  className={`h-full rounded-full transition-[width] duration-1000 ease-out ${
                    full ? 'bg-[#17a34a]' : 'bg-[#f0521e]'
                  }`}
                  style={{ width: inView ? `${pct}%` : '0%', transitionDelay: `${i * 160}ms` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Menu manager slice */}
      <div className="mt-3 border-t border-[#e7e6e1] pt-3">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#5f636a]">
          Menu manager
        </p>
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-[#e7e6e1]">
            <span className="min-w-0">
              <span className="block truncate text-[10.5px] font-semibold text-[#1b1c1e]">
                Paneer power bowl · Rs 490
              </span>
              <span className="block text-[9px] text-[#5f636a]">620 kcal · 42 g protein</span>
            </span>
            <Toggle on />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 opacity-70 ring-1 ring-[#e7e6e1]">
            <span className="min-w-0">
              <span className="block truncate text-[10.5px] font-semibold text-[#1b1c1e]">
                Lemon iced tea · Rs 120
              </span>
              <span className="block text-[9px] text-[#5f636a]">60 kcal · sold out today</span>
            </span>
            <Toggle on={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
