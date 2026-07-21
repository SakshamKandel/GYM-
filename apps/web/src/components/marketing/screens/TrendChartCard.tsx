'use client';

/**
 * Wide (non-phone) progress visual: raw daily weigh-ins as dots with the EWMA
 * trend line drawing itself across — the app's actual smoothing story.
 */
import { useInView } from '../motion';

// Pre-computed plausible 16-week cut: raw scale weight (kg) + EWMA trend.
const RAW = [78.4, 78.9, 78.1, 78.6, 77.8, 78.2, 77.4, 77.9, 77.1, 76.8, 77.3, 76.5, 76.9, 76.1, 75.8, 76.2, 75.4, 75.9, 75.1, 74.8, 75.2, 74.5, 74.9, 74.2, 74.6, 73.9, 74.3, 74.0];
const W = 720;
const H = 240;
const PAD = 24;

function scaleX(i: number) {
  return PAD + (i / (RAW.length - 1)) * (W - PAD * 2);
}
function scaleY(v: number) {
  const min = 73.4;
  const max = 79.4;
  return PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2);
}

function ewma(values: number[], alpha = 0.25): number[] {
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : alpha * v + (1 - alpha) * out[i - 1]));
  return out;
}

export function TrendChartCard() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const trend = ewma(RAW);
  const path = trend
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`)
    .join(' ');

  return (
    <div ref={ref} className="mkt-glass-deep rounded-block p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-dim">
            Weight trend · 16 weeks
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-5xl font-medium text-snow">74.0</span>
            <span className="font-mono text-[13px] text-dim">kg</span>
            <span className="rounded-full bg-red/15 px-3 py-1 font-mono text-[12px] font-medium text-red-glow">
              −4.4 kg
            </span>
          </div>
        </div>
        <div className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-faint" /> Daily weigh-in
          </span>
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-5 rounded-full bg-red" /> Smoothed trend
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-6 w-full" role="img" aria-label="Weight trend chart: 78.4 kg smoothed down to 74.0 kg over 16 weeks">
        {/* gridlines */}
        {[75, 77, 79].map((g) => (
          <line
            key={g}
            x1={PAD}
            x2={W - PAD}
            y1={scaleY(g)}
            y2={scaleY(g)}
            stroke="#2E3135"
            strokeDasharray="3 6"
          />
        ))}
        {/* raw dots */}
        {RAW.map((v, i) => (
          <circle
            key={i}
            cx={scaleX(i)}
            cy={scaleY(v)}
            r={3}
            fill="#63676E"
            opacity={inView ? 0.85 : 0}
            style={{ transition: `opacity 0.4s ease ${i * 30}ms` }}
          />
        ))}
        {/* EWMA line draws in */}
        <path
          d={path}
          fill="none"
          stroke="#FF3B30"
          strokeWidth={3.5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={inView ? 0 : 1}
          style={{ transition: 'stroke-dashoffset 2.2s cubic-bezier(0.25,1,0.5,1) 0.2s' }}
        />
        {/* end dot */}
        <circle
          cx={scaleX(RAW.length - 1)}
          cy={scaleY(trend[trend.length - 1])}
          r={6}
          fill="#FF3B30"
          opacity={inView ? 1 : 0}
          style={{ transition: 'opacity 0.3s ease 2.2s' }}
        />
      </svg>
    </div>
  );
}
