'use client';

/**
 * "Raw scale vs trend" explainer — two mini sparklines side by side: the same
 * 30 days as jittery grey daily weigh-ins and as the smoothed red trend.
 * Deliberately NOT Home's TrendChartCard — this is the before/after argument.
 */
import { Reveal, useInView } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

// 30 days of plausible scale weight: ±0.8 kg overnight swings, −2.1 kg net.
const RAW = [
  75.8, 76.6, 75.7, 76.2, 75.4, 76.0, 76.4, 75.5, 75.1, 75.8, 75.2, 75.9, 75.0, 74.6, 75.3,
  74.8, 75.4, 74.5, 74.9, 74.3, 75.0, 74.4, 73.9, 74.6, 74.1, 74.5, 73.8, 74.3, 73.7, 73.7,
];

function ewma(values: number[], alpha = 0.25): number[] {
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : alpha * v + (1 - alpha) * out[i - 1]));
  return out;
}

const TREND = ewma(RAW);

const W = 300;
const H = 132;
const PAD = 14;
const MIN = 73.4;
const MAX = 76.9;

function linePath(values: number[]): string {
  return values
    .map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (v - MIN) / (MAX - MIN)) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function Sparkline({
  values,
  stroke,
  width,
  inView,
  delay = 0,
  label,
}: {
  values: number[];
  stroke: string;
  width: number;
  inView: boolean;
  delay?: number;
  label: string;
}) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label={label}>
      {[74, 75, 76].map((g) => (
        <line
          key={g}
          x1={PAD}
          x2={W - PAD}
          y1={PAD + (1 - (g - MIN) / (MAX - MIN)) * (H - PAD * 2)}
          y2={PAD + (1 - (g - MIN) / (MAX - MIN)) * (H - PAD * 2)}
          stroke="#2E3135"
          strokeDasharray="2 6"
        />
      ))}
      <path
        d={linePath(values)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={inView ? 0 : 1}
        style={{ transition: `stroke-dashoffset 1.9s cubic-bezier(0.25,1,0.5,1) ${delay}ms` }}
      />
    </svg>
  );
}

export function TrendExplainer() {
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <Section tone="coal">
      <Container wide>
        <div className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Reveal>
              <Eyebrow>01 — Weight trend</Eyebrow>
              <Display className="mt-4">
                One number
                <br />
                you can trust.
              </Display>
              <Lead className="mt-6">
                Your weight swings close to a kilo overnight for reasons that have nothing to
                do with fat — water, salt, sleep, timing. The app plots every weigh-in, then
                smooths them with an exponentially-weighted moving average so the line you
                watch is the one that&rsquo;s actually moving.
              </Lead>
            </Reveal>
            <Reveal delay={140}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>A daily weigh-in takes five seconds — the math does the rest</CheckItem>
                <CheckItem>The smoothing is unit-tested, not vibes-tuned</CheckItem>
                <CheckItem>Your weekly report on Home reads the trend, never the spikes</CheckItem>
              </ul>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <div ref={ref} className="mkt-glass-deep rounded-block p-6 sm:p-8">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-inner bg-ink/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
                      The scale · raw
                    </p>
                    <span className="rounded-full bg-white/8 px-2.5 py-1 font-mono text-[11px] font-medium text-dim">
                      ±0.8 kg overnight
                    </span>
                  </div>
                  <Sparkline
                    values={RAW}
                    stroke="#63676E"
                    width={2.5}
                    inView={inView}
                    label="Raw daily weigh-ins: jittery line swinging up to 0.8 kilograms day to day"
                  />
                  <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
                    Jumps around on water, salt and sleep. Reading it daily is how diets die.
                  </p>
                </div>
                <div className="rounded-inner bg-ink/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
                      Your trend · smoothed
                    </p>
                    <span className="rounded-full bg-mint/15 px-2.5 py-1 font-mono text-[11px] font-medium text-mint">
                      −0.5 kg / week
                    </span>
                  </div>
                  <Sparkline
                    values={TREND}
                    stroke="#FF3B30"
                    width={3.5}
                    inView={inView}
                    delay={400}
                    label="Smoothed trend of the same days: a calm line descending half a kilogram per week"
                  />
                  <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
                    The same 30 days after smoothing. Steady, believable, worth acting on.
                  </p>
                </div>
              </div>
              <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                Same body · same month · only the math differs
              </p>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
