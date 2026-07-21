'use client';

/**
 * Wide (non-phone) progress visual: a vertical timeline of auto-detected PRs.
 * The red spine grows downward and each entry — date, lift, weight jump —
 * draws in as the line reaches it.
 */
import { useInView } from '../motion';

const PRS = [
  { date: 'APR 14', lift: 'Deadlift', from: '140', to: '145 kg', latest: false },
  { date: 'MAY 02', lift: 'Back Squat', from: '122.5', to: '125 kg', latest: false },
  { date: 'MAY 30', lift: 'Bench Press', from: '92.5', to: '95 kg', latest: false },
  { date: 'JUN 21', lift: 'Weighted Pull-up', from: '+20', to: '+22.5 kg', latest: true },
] as const;

export function PRTimelineCard() {
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className="mkt-glass-deep rounded-block p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-dim">
          PR timeline · auto-detected
        </p>
        <span className="rounded-full bg-red/15 px-3 py-1 font-mono text-[12px] font-medium text-red-glow">
          4 PRs this cycle
        </span>
      </div>

      <div className="relative mt-8">
        {/* Spine track + growing red fill */}
        <span
          aria-hidden
          className="absolute bottom-2 left-[10px] top-2 w-[3px] rounded-full bg-charcoal-3"
        />
        <span
          aria-hidden
          className="absolute bottom-2 left-[10px] top-2 w-[3px] origin-top rounded-full bg-red"
          style={{
            transform: inView ? 'scaleY(1)' : 'scaleY(0)',
            transition: 'transform 1.7s cubic-bezier(0.25,1,0.5,1) 150ms',
          }}
        />

        <ol className="flex flex-col gap-8">
          {PRS.map((pr, i) => {
            const delay = 350 + i * 380;
            return (
              <li key={pr.lift} className="relative pl-11">
                <span
                  aria-hidden
                  className="absolute left-0 top-0.5 flex size-[23px] items-center justify-center rounded-full bg-red text-[11px] font-bold text-ink"
                  style={{
                    transform: inView ? 'scale(1)' : 'scale(0)',
                    transition: `transform 0.35s cubic-bezier(0.25,1,0.5,1) ${delay}ms`,
                  }}
                >
                  ✓
                </span>
                <div
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
                  style={{
                    opacity: inView ? 1 : 0,
                    transform: inView ? 'translateY(0)' : 'translateY(10px)',
                    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s cubic-bezier(0.25,1,0.5,1) ${delay}ms`,
                  }}
                >
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
                      {pr.date}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2.5 text-[15.5px] font-semibold text-snow">
                      {pr.lift}
                      {pr.latest ? (
                        <span className="rounded-full bg-red px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-ink">
                          Latest
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <p className="font-display text-2xl font-medium text-snow sm:text-3xl">
                    <span className="text-faint">{pr.from}</span>
                    <span aria-hidden className="mx-2.5 text-red">
                      →
                    </span>
                    {pr.to}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mkt-divider mt-8" />
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
        Checked against your full history the moment a set saves
      </p>
    </div>
  );
}
