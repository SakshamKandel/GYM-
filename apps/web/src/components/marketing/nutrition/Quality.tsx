'use client';

/**
 * /nutrition food-quality section (paper) — NON-phone visual: a white
 * hairline card with the Nutri-Score A–E tile scale (B highlighted, matching
 * the scanned bar in the hero), the four NOVA processing levels, and ink
 * signal chips for the per-100 g reads. Copy stays deliberately honest:
 * signals, not moralizing.
 */
import { Reveal, useInView } from '../motion';
import { Card, Container, Display, Eyebrow, Hairline, Lead, Section } from '../ui';

const SCORES = [
  { letter: 'A', bg: 'bg-mint' },
  { letter: 'B', bg: 'bg-gold' },
  { letter: 'C', bg: 'bg-orange' },
  { letter: 'D', bg: 'bg-red' },
  { letter: 'E', bg: 'bg-red-deep' },
] as const;

const NOVA = [
  { n: '1', label: 'Unprocessed or minimal', note: 'dal, rice, greens', hot: true },
  { n: '2', label: 'Culinary ingredients', note: 'ghee, oil, salt', hot: false },
  { n: '3', label: 'Processed foods', note: 'cheese, canned beans', hot: false },
  { n: '4', label: 'Ultra-processed', note: 'instant noodles', hot: false },
] as const;

const SIGNALS = [
  { label: 'Fiber 7.9 g', verdict: 'high', color: 'text-mint' },
  { label: 'Sugar 1.8 g', verdict: 'low', color: 'text-mint' },
  { label: 'Sodium 0.24 g', verdict: 'moderate', color: 'text-gold' },
] as const;

function QualityPanel() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref}>
      <Card tone="light">
        {/* Nutri-Score scale */}
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-gravel">
          Nutri-Score
        </p>
        <div className="mt-4 grid grid-cols-5 gap-2.5">
          {SCORES.map((s, i) => {
            const hot = s.letter === 'B';
            return (
              <div
                key={s.letter}
                style={{ transitionDelay: `${i * 70}ms` }}
                className={`flex aspect-square items-center justify-center rounded-[14px] font-display text-2xl font-medium text-ink transition-all duration-500 ease-out-quart sm:text-3xl ${s.bg} ${
                  inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
                } ${hot ? 'scale-105 ring-2 ring-ink/25 ring-offset-2 ring-offset-white' : ''}`}
              >
                {s.letter}
              </div>
            );
          })}
        </div>
        <div className="mt-2.5 grid grid-cols-5 gap-2.5">
          <p className="col-start-2 text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-gravel-faint">
            ▲ your scanned bar
          </p>
        </div>

        <Hairline className="my-6" />

        {/* NOVA processing ladder */}
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-gravel">
          NOVA processing level
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {NOVA.map((row, i) => (
            <div
              key={row.n}
              style={{ transitionDelay: `${350 + i * 80}ms` }}
              className={`flex min-h-[50px] items-center gap-3.5 rounded-inner px-4 py-2.5 transition-all duration-500 ease-out-quart ${
                inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
              } ${row.hot ? 'border border-red/40 bg-red/5' : 'bg-paper-2'}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-[9px] font-display text-[15px] font-medium ${
                  row.hot ? 'bg-red text-ink' : 'border border-mist bg-white text-ink'
                }`}
              >
                {row.n}
              </span>
              <span className="flex-1 text-[13.5px] font-semibold text-ink">{row.label}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-gravel-faint">
                {row.note}
              </span>
            </div>
          ))}
        </div>

        <Hairline className="my-6" />

        {/* Per-100 g signal chips — ink pills, the card's Iron accent */}
        <div className="flex flex-wrap items-center gap-2.5">
          {SIGNALS.map((sig) => (
            <span
              key={sig.label}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-snow"
            >
              {sig.label}
              <span className={`font-semibold ${sig.color}`}>{sig.verdict}</span>
            </span>
          ))}
        </div>
        <p className="mt-3.5 font-mono text-[10px] uppercase tracking-[0.14em] text-gravel-faint">
          Per 100 g · masoor dal, cooked · USDA record
        </p>
      </Card>
    </div>
  );
}

export function NutritionQuality() {
  return (
    <Section tone="paper" id="quality">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <Reveal>
              <Eyebrow tone="light">03 — Food quality</Eyebrow>
              <Display className="mt-4">
                Signals,
                <br />
                not sermons.
              </Display>
              <Lead tone="light" className="mt-6">
                Every matched food carries its evidence: a Nutri-Score letter, its NOVA
                processing level, plus fiber, sugar and sodium. We surface the numbers and
                skip the guilt — no food is &ldquo;bad&rdquo;, some are just
                information-rich.
              </Lead>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-gravel">
                The scores come straight from Open Food Facts and USDA records. We don&rsquo;t
                editorialize them, re-weight them, or hide them behind a paywall — they sit
                right in the scan result and the search rows.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200}>
            <QualityPanel />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
