'use client';

/**
 * Gym-mode section (paper) — copy + numbered feature rows on the right,
 * animated plate-loading SVG diagram + barbell photo on the left. The plate
 * diagram is the section's non-phone visual: plates slide onto a sleeve to
 * build 72.5 kg, the exact job of the in-app plate calculator.
 */
import { Parallax, Reveal, useStepLoop } from '../motion';
import { Card, Container, Display, Eyebrow, Hairline, Lead, PhotoBlock, Section } from '../ui';

const PLATES = [
  { kg: '20', w: 22, h: 132, fill: '#FF3B30', edge: 'none' },
  { kg: '5', w: 16, h: 84, fill: '#F4F2ED', edge: '#D8D7CF' },
  { kg: '1.25', w: 12, h: 48, fill: '#9BA0A8', edge: 'none' },
] as const;

const TOTALS = ['20', '60', '70', '72.5'] as const;

function PlateLoaderCard() {
  // 0 = bare bar · 1–3 = plates slide on · 4–5 = hold the loaded bar.
  const [ref, step] = useStepLoop(6, 900, 3);
  const shown = Math.min(step, PLATES.length);
  const total = TOTALS[shown] ?? '72.5';

  // Target x for each plate on the sleeve.
  const xs = [306, 332, 352] as const;

  return (
    <Card tone="light" className="overflow-hidden">
      <div ref={ref} className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-gravel">
            Plate calculator
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-6xl font-medium tabular-nums text-ink">
              {total}
            </span>
            <span className="font-display text-xl font-medium text-gravel">kg</span>
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-gravel-faint">
            20 kg bar · 26.25 / side
          </p>
        </div>

        <svg viewBox="0 0 460 200" className="w-full min-w-0" aria-hidden>
          {/* shaft */}
          <rect x="14" y="96" width="272" height="8" rx="4" fill="#3B3E44" />
          {/* collar */}
          <rect x="286" y="80" width="14" height="40" rx="4" fill="#63676E" />
          {/* sleeve */}
          <rect x="300" y="92" width="148" height="16" rx="7" fill="#4A4D52" />
          {/* plates slide in from the right */}
          {PLATES.map((p, i) => {
            const on = shown > i;
            return (
              <g
                key={p.kg}
                style={{
                  transform: on ? 'translateX(0)' : 'translateX(120px)',
                  opacity: on ? 1 : 0,
                  transition:
                    'transform 0.5s cubic-bezier(0.25,1,0.5,1), opacity 0.35s ease',
                }}
              >
                <rect
                  x={xs[i]}
                  y={100 - p.h / 2}
                  width={p.w}
                  height={p.h}
                  rx="6"
                  fill={p.fill}
                  stroke={p.edge}
                />
                <text
                  x={(xs[i] ?? 0) + p.w / 2}
                  y="188"
                  textAnchor="middle"
                  fill="#63676E"
                  style={{ font: '600 12px var(--font-mono, monospace)' }}
                >
                  {p.kg}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}

const FEATURES = [
  {
    n: '01',
    title: 'Auto rest timer',
    body: 'Log a set and the clock starts itself — 90 seconds by default, adjustable mid-rest without leaving the screen.',
  },
  {
    n: '02',
    title: 'Plate calculator',
    body: 'Tell it the target weight and it tells you exactly what goes on each side. No mental math between heavy sets.',
  },
  {
    n: '03',
    title: 'Last-time ghosts',
    body: 'Every set row shows what you lifted last session, so progression is a decision, not a memory test.',
  },
] as const;

export function GymModeSection() {
  return (
    <Section tone="paper">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="order-2 flex flex-col gap-5 lg:order-1">
            <Reveal>
              <PlateLoaderCard />
            </Reveal>
            <Reveal delay={120}>
              <Parallax range={40}>
                <PhotoBlock
                  src="/stock/barbell-grip-overhead.jpg"
                  alt="Chalked hands gripping a loaded barbell, seen from above"
                  caption="Set 3 of 4 · rest starts itself"
                  className="aspect-[16/10]"
                />
              </Parallax>
            </Reveal>
          </div>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow tone="light">01 — Gym mode</Eyebrow>
              <Display className="mt-4">
                Set. Rest.
                <br />
                Repeat.
              </Display>
              <Lead tone="light" className="mt-6">
                Hit start and gym mode carries you set to set. The rest timer runs
                itself, the next exercise is queued, and the bar math is done before
                you rack the weight.
              </Lead>
            </Reveal>
            <div className="mt-10">
              {FEATURES.map((f, i) => (
                <Reveal key={f.n} delay={120 + i * 90}>
                  {i > 0 ? <Hairline /> : null}
                  <div className="flex gap-5 py-5">
                    <span className="font-mono text-[12px] tracking-[0.2em] text-gravel-faint">
                      {f.n}
                    </span>
                    <div>
                      <h3 className="font-display text-xl font-medium uppercase text-ink">
                        {f.title}
                      </h3>
                      <p className="mt-1.5 max-w-md text-[14.5px] leading-relaxed text-gravel">
                        {f.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
