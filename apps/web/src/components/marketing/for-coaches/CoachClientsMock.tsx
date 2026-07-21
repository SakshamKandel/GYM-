'use client';

/**
 * Mock: the coach web console's client roster — light-SaaS look matching the
 * real console (bg #f5f5f2 / cards #fff / text #1b1c1e / accent #f0521e).
 * Summary tiles up top, 4-row roster with a single needs-attention flag.
 */
import { CountUp, useInView } from '../motion';
import { BrowserFrame } from '../PhoneFrame';

const CLIENTS = [
  { initial: 'A', name: 'Anisha S.', plan: 'Strength · wk 9', last: 'Today', flag: false },
  { initial: 'B', name: 'Bibek R.', plan: 'Cut · wk 6', last: 'Yesterday', flag: false },
  { initial: 'D', name: 'Dolma L.', plan: 'Hypertrophy A', last: '5 d ago', flag: true },
  { initial: 'S', name: 'Suraj K.', plan: 'Beginner 3-day', last: '2 d ago', flag: false },
] as const;

const NAV_ICONS = [
  // roster (active)
  <path key="roster" d="M12 5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm-7 14a7 7 0 0 1 14 0v1H5v-1Z" />,
  // review queue
  <path key="review" d="M4 4h16v16H4V4Zm4 8.2 2.6 2.6L16.4 9l-1.4-1.4-4.4 4.4-1.2-1.2L8 12.2Z" />,
  // chat
  <path key="chat" d="M4 4h16v12H9l-5 4V4Z" />,
  // wallet
  <path key="wallet" d="M3 6h18v12H3V6Zm12 4h6v4h-6v-4Z" />,
];

export function CoachClientsMock({ className = '' }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <BrowserFrame url="thegmmethod.com/coach/clients" className={className}>
      <div ref={ref} className="flex">
        {/* console sidebar */}
        <aside className="hidden w-[52px] shrink-0 flex-col items-center gap-3 border-r border-[#e7e6e0] bg-white py-4 sm:flex">
          <span className="mb-1 flex size-7 items-center justify-center rounded-lg bg-[#f0521e] text-[12px] font-bold text-white">
            G
          </span>
          {NAV_ICONS.map((icon, i) => (
            <span
              key={i}
              className={`flex size-7 items-center justify-center rounded-lg ${
                i === 0 ? 'bg-[#fdeee8] text-[#f0521e]' : 'text-[#a3a49e]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                {icon}
              </svg>
            </span>
          ))}
        </aside>

        {/* main pane */}
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8b86]">
                Coach console
              </p>
              <h4 className="mt-0.5 text-[16px] font-bold leading-tight text-[#1b1c1e]">Clients</h4>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#5f636a]">
              14 / 20 capacity
            </span>
          </div>

          {/* summary tiles */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-3">
              <p className="font-display text-[22px] font-medium leading-none text-[#1b1c1e]">
                <CountUp to={inView ? 14 : 0} duration={900} />
              </p>
              <p className="mt-1 text-[10px] font-medium text-[#8a8b86]">Active clients</p>
            </div>
            <div className="rounded-xl bg-white p-3">
              <p className="font-display text-[22px] font-medium leading-none text-[#b45309]">
                <CountUp to={inView ? 1 : 0} duration={900} />
              </p>
              <p className="mt-1 text-[10px] font-medium text-[#8a8b86]">Needs attention</p>
            </div>
            <div className="rounded-xl bg-white p-3">
              <p className="font-display text-[22px] font-medium leading-none text-[#1b1c1e]">
                <CountUp to={inView ? 5 : 0} duration={900} />
              </p>
              <p className="mt-1 text-[10px] font-medium text-[#8a8b86]">Unread chats</p>
            </div>
          </div>

          {/* roster table */}
          <div className="mt-3 overflow-hidden rounded-xl bg-white">
            <div className="grid grid-cols-[1.35fr_1fr_0.75fr_1.05fr] gap-2 border-b border-[#f0efe9] px-3.5 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#a3a49e]">
              <span>Client</span>
              <span>Plan</span>
              <span>Last workout</span>
              <span className="text-right">Status</span>
            </div>
            {CLIENTS.map((c, i) => (
              <div
                key={c.name}
                style={{ transitionDelay: `${i * 90}ms` }}
                className={`grid grid-cols-[1.35fr_1fr_0.75fr_1.05fr] items-center gap-2 border-b border-[#f0efe9] px-3.5 py-2.5 transition-all duration-500 last:border-b-0 ${
                  inView ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eceae4] text-[10px] font-bold text-[#1b1c1e]">
                    {c.initial}
                  </span>
                  <span className="truncate text-[11.5px] font-semibold text-[#1b1c1e]">
                    {c.name}
                  </span>
                </span>
                <span>
                  <span className="rounded-md bg-[#f5f5f2] px-2 py-1 text-[10px] font-medium text-[#5f636a]">
                    {c.plan}
                  </span>
                </span>
                <span className="text-[10.5px] text-[#5f636a]">{c.last}</span>
                <span className="flex justify-end">
                  {c.flag ? (
                    <span className="flex items-center gap-1 rounded-full bg-[#faf0dd] px-2 py-1 text-[9.5px] font-bold text-[#b45309]">
                      <svg width="8" height="9" viewBox="0 0 8 10" fill="currentColor" aria-hidden>
                        <path d="M0 0h1.4v10H0V0Zm1.4.8h6.2L5.4 3.4l2.2 2.6H1.4V.8Z" />
                      </svg>
                      Needs attention
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-[#eaf4ed] px-2 py-1 text-[9.5px] font-bold text-[#1c7c46]">
                      <span className="size-1.5 rounded-full bg-[#1c7c46]" />
                      On track
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
