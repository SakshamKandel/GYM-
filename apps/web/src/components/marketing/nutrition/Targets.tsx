'use client';

/**
 * /nutrition targets section — ink band, pure data visual (no phone): the
 * onboarding-quiz → computed-targets flow. Three input chips converge through
 * an SVG ember flow into a daily kcal / protein / water output panel.
 */
import { CountUp, Reveal, useInView } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const INPUTS = [
  { label: 'Goal', value: 'Lean muscle gain' },
  { label: 'Body', value: '72 kg · 176 cm' },
  { label: 'Activity', value: '4 training days / wk' },
] as const;

function FlowConnector({ drawn }: { drawn: boolean }) {
  const dash = 300;
  return (
    <svg
      viewBox="0 0 72 260"
      className="hidden h-[260px] w-[72px] sm:block"
      aria-hidden
      fill="none"
    >
      <defs>
        <linearGradient id="nt-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF3B30" stopOpacity="0.15" />
          <stop offset="1" stopColor="#FF3B30" />
        </linearGradient>
      </defs>
      {['M0 44 C 38 44, 30 130, 68 130', 'M0 130 C 30 130, 40 130, 68 130', 'M0 216 C 38 216, 30 130, 68 130'].map(
        (d) => (
          <path
            key={d}
            d={d}
            stroke="url(#nt-flow)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={dash}
            strokeDashoffset={drawn ? 0 : dash}
            style={{ transition: 'stroke-dashoffset 1.3s cubic-bezier(0.25,1,0.5,1)' }}
          />
        ),
      )}
      <circle
        cx="68"
        cy="130"
        r="4.5"
        fill="#FF3B30"
        opacity={drawn ? 1 : 0}
        style={{ transition: 'opacity 0.5s ease 0.9s' }}
      />
    </svg>
  );
}

function TargetsFlow() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className="mkt-glass-deep rounded-block p-6 sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
        computeTargets( ) · from your onboarding quiz
      </p>

      <div className="mt-6 grid items-center gap-4 sm:grid-cols-[1fr_72px_1.05fr] sm:gap-0">
        {/* Quiz answers in */}
        <div className="flex flex-col gap-3">
          {INPUTS.map((inp, i) => (
            <div
              key={inp.label}
              style={{ transitionDelay: `${i * 90}ms` }}
              className={`mkt-glass rounded-inner px-4 py-3 transition-all duration-500 ease-out-quart ${
                inView ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
              }`}
            >
              <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-dim">
                {inp.label}
              </p>
              <p className="mt-0.5 text-[13.5px] font-semibold text-snow">{inp.value}</p>
            </div>
          ))}
        </div>

        <FlowConnector drawn={inView} />
        <p aria-hidden className="text-center font-display text-xl text-red sm:hidden">
          ↓
        </p>

        {/* Computed targets out */}
        <div
          className={`mkt-glass rounded-inner p-5 transition-all delay-500 duration-700 ease-out-quart ${
            inView ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-dim">
            Daily targets
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="mkt-text-steel font-display text-[46px] font-medium leading-none">
              <CountUp to={2450} duration={1400} />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
              kcal
            </span>
          </div>
          <div className="mkt-divider my-4" />
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
              Protein
            </span>
            <span className="font-display text-[26px] font-medium text-snow">
              <CountUp to={158} duration={1400} />
              <span className="text-[15px] text-dim"> g</span>
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-water">
              Water
            </span>
            <span className="font-display text-[26px] font-medium text-snow">
              <CountUp to={3} decimals={1} duration={1400} />
              <span className="text-[15px] text-dim"> L</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NutritionTargets() {
  return (
    <Section tone="ink" id="targets">
      <Container wide>
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
          <Reveal delay={200} className="order-2 lg:order-1">
            <TargetsFlow />
          </Reveal>

          <div className="order-1 lg:order-2">
            <Reveal>
              <Eyebrow>04 — Targets</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display size="lg" className="mt-4">
                Answers in.
                <br />
                <span className="mkt-text-ember">Targets</span> out.
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead className="mt-6">
                A two-minute onboarding quiz — goal, body, training days — feeds the target
                engine that sets your daily kcal, protein and water. Change your goal and
                the numbers follow. No spreadsheet required.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem>12-step quiz, done once — edit any answer later</CheckItem>
                <CheckItem>Targets recompute when your weight or goal changes</CheckItem>
                <CheckItem>Water tracking with one-tap glasses against a daily goal</CheckItem>
                <CheckItem>Rings on the Food dashboard fill toward today&rsquo;s targets</CheckItem>
              </ul>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}
