'use client';

/**
 * Auto-logging v3 — on paper, with the looping data-flow panel kept dark:
 * delivered order → connector dots → Food-diary macro rings filling. The
 * "Iron" inside the "Paper" (same treatment as Home's trend chart card).
 */
import { Parallax, Reveal, useStepLoop } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const RINGS = [
  { value: '580', label: 'kcal', color: '#FF3B30', pct: 62 },
  { value: '42g', label: 'protein', color: '#4A8CFF', pct: 78 },
  { value: '48g', label: 'carbs', color: '#FFC53D', pct: 55 },
  { value: '18g', label: 'fat', color: '#34C759', pct: 40 },
] as const;

function Ring({
  value,
  label,
  color,
  pct,
  filled,
}: {
  value: string;
  label: string;
  color: string;
  pct: number;
  filled: boolean;
}) {
  const size = 76;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#2E3135"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - (filled ? pct : 0) / 100)}
            style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.25,1,0.5,1)' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-[16px] font-medium text-snow">
          {value}
        </span>
      </div>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">{label}</span>
    </div>
  );
}

export function AutoLogging() {
  // 0 reset · 1 delivered chip · 2–3 connector dots · 4 rings fill · 5 hold.
  const [ref, step] = useStepLoop(6, 1000, 5);
  const delivered = step >= 1;
  const filled = step >= 4;

  return (
    <Section tone="paper">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Reveal>
              <Eyebrow tone="light">Auto-logging</Eyebrow>
              <Display className="mt-4">
                Delivered means
                <br />
                <span className="text-red-deep">logged.</span>
              </Display>
              <Lead tone="light" className="mt-6">
                The moment your order lands, its kcal and macros post straight into your Food
                diary — the same diary your targets live on. No searching, no eyeballing the
                portion, no forgetting.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="light">Exact kcal and macros from the kitchen’s recipe card</CheckItem>
                <CheckItem tone="light">Posts to the right day, next to everything you scanned</CheckItem>
                <CheckItem tone="light">Edit or remove it like any other diary entry</CheckItem>
              </ul>
            </Reveal>
          </div>

          <Parallax range={36}>
            <Reveal delay={100}>
              <div ref={ref}>
                <div className="mx-auto max-w-[480px] rounded-block bg-ink p-5 shadow-pop sm:p-6">
                  {/* Delivered order */}
                  <div className="rounded-inner bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[14.5px] font-semibold text-snow">Paneer power bowl</p>
                        <p className="mt-0.5 text-[12px] text-dim">
                          Himalaya Bowl Kitchen · Rs 490
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-mint/15 px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-mint transition-all duration-300 ${
                          delivered ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
                        }`}
                      >
                        <span className="size-1.5 rounded-full bg-mint" />
                        Delivered 12:47
                      </span>
                    </div>
                  </div>

                  {/* Connector dots */}
                  <div className="flex flex-col items-center gap-1.5 py-3.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={`size-1.5 rounded-full transition-colors duration-300 ${
                          step >= i + 1 ? 'bg-red' : 'bg-white/15'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Diary rings */}
                  <div className="rounded-inner bg-white/5 p-5">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[14px] font-semibold text-snow">Food diary</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                        Mon · Jul 21
                      </p>
                    </div>
                    <div className="mt-5 grid grid-cols-4 gap-2">
                      {RINGS.map((ring) => (
                        <Ring key={ring.label} {...ring} filled={filled} />
                      ))}
                    </div>
                    <p
                      className={`mt-5 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] transition-colors duration-500 ${
                        filled ? 'text-red-glow' : 'text-faint'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full transition-colors duration-500 ${
                          filled ? 'bg-red shadow-ember' : 'bg-white/15'
                        }`}
                      />
                      Logged automatically · GM Meals
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          </Parallax>
        </div>
      </Container>
    </Section>
  );
}
