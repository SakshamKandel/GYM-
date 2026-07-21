'use client';

/**
 * Mock: the coach wallet in the web console — balance card, commission ledger
 * (promo-code attributed), payout request button. Same light-SaaS palette as
 * the real console.
 */
import { CountUp, useInView } from '../motion';
import { BrowserFrame } from '../PhoneFrame';

const LEDGER = [
  { amount: '+Rs 1,140', label: 'Commission — promo GAURAV30', date: 'Jul 19', kind: 'in' },
  { amount: '+Rs 855', label: 'Commission — promo GAURAV30', date: 'Jul 15', kind: 'in' },
  { amount: '−Rs 12,000', label: 'Payout — processed', date: 'Jul 12', kind: 'out' },
  { amount: '+Rs 1,140', label: 'Commission — promo GAURAV30', date: 'Jul 8', kind: 'in' },
] as const;

export function CoachWalletMock({ className = '' }: { className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>('0px');

  return (
    <BrowserFrame url="thegmmethod.com/coach/wallet" className={className}>
      <div ref={ref} className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8a8b86]">
              Coach console
            </p>
            <h4 className="mt-0.5 text-[16px] font-bold leading-tight text-[#1b1c1e]">Wallet</h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5f636a]">
            Promo · GAURAV30
          </span>
        </div>

        {/* balance card */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-white p-4">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#a3a49e]">
              Available balance
            </p>
            <p className="mt-1 font-display text-[34px] font-medium leading-none text-[#1b1c1e]">
              <CountUp to={inView ? 9780 : 0} duration={1200} prefix="Rs " />
            </p>
            <p className="mt-1.5 text-[10.5px] text-[#8a8b86]">
              30% of every subscription bought with your code
            </p>
          </div>
          <span className="rounded-full bg-[#f0521e] px-4 py-2.5 text-[12px] font-semibold text-white">
            Request payout
          </span>
        </div>

        {/* ledger */}
        <div className="mt-3 overflow-hidden rounded-xl bg-white">
          <div className="flex items-baseline justify-between border-b border-[#f0efe9] px-3.5 py-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#a3a49e]">
              Ledger
            </span>
            <span className="text-[9.5px] text-[#a3a49e]">Every rupee itemised</span>
          </div>
          {LEDGER.map((row, i) => (
            <div
              key={`${row.date}-${row.amount}`}
              style={{ transitionDelay: `${i * 90}ms` }}
              className={`flex items-center gap-3 border-b border-[#f0efe9] px-3.5 py-2.5 transition-all duration-500 last:border-b-0 ${
                inView ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  row.kind === 'in' ? 'bg-[#eaf4ed] text-[#1c7c46]' : 'bg-[#f5f5f2] text-[#5f636a]'
                }`}
              >
                {row.kind === 'in' ? '↓' : '↑'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold text-[#1b1c1e]">
                  {row.label}
                </span>
                <span className="block text-[10px] text-[#8a8b86]">{row.date}</span>
              </span>
              <span
                className={`font-display text-[14px] font-medium ${
                  row.kind === 'in' ? 'text-[#1c7c46]' : 'text-[#5f636a]'
                }`}
              >
                {row.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}
