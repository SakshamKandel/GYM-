'use client';

/**
 * Mock: public coach profile — hero identity block, GOLD seniority badge,
 * coach-logged client milestones ticking in, certifications, and the
 * capacity-gated "Request coaching" red block.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, BlockCard, BlockPill, MetaChip } from './appkit';

const MILESTONES = [
  { value: '−12 kg', label: 'Client cut · 16 weeks' },
  { value: '100 kg squat', label: 'First-ever · client PR' },
  { value: '+6 kg lean', label: 'Postpartum return · 20 wk' },
] as const;

const CERTS = ['NSCA-CPT', 'FMS Level 2', 'PN Level 1'] as const;

export function CoachProfileScreen() {
  const [ref, step] = useStepLoop(6, 1100, 4);
  const shown = Math.min(step, MILESTONES.length);

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        {/* Back row */}
        <div className="flex items-center gap-1.5 text-dim">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M15 5 8 12l7 7" />
          </svg>
          <span className="text-[12px] font-medium">Coaches</span>
        </div>

        {/* Profile hero */}
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-cream font-display text-[24px] font-medium text-ink">
            M
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-bold leading-tight">Maya Shrestha</span>
              <span className="shrink-0 rounded-full bg-gold/15 px-2.5 py-1 font-display text-[10px] font-medium uppercase tracking-[0.14em] text-gold">
                Gold
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-dim">Strength coach · 8 yrs · 14 clients</p>
          </div>
        </div>

        {/* Specialties */}
        <div className="flex gap-2">
          <MetaChip>Powerlifting</MetaChip>
          <MetaChip>Form rehab</MetaChip>
        </div>

        {/* Coach-logged client milestones */}
        <div>
          <AppEyebrow>Client milestones</AppEyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {MILESTONES.map((m, i) => (
              <div
                key={m.value}
                className={`flex min-h-[48px] items-center gap-3 rounded-[16px] bg-charcoal px-4 py-2.5 transition-all duration-500 ${
                  i < shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                }`}
              >
                <span className="size-2.5 shrink-0 rounded-full bg-red" />
                <span className="flex-1 font-display text-[17px] font-medium uppercase leading-none">
                  {m.value}
                </span>
                <span className="text-[10.5px] text-dim">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Certifications */}
        <div>
          <AppEyebrow>Certifications</AppEyebrow>
          <div className="mt-2 flex gap-1.5">
            {CERTS.map((c) => (
              <span
                key={c}
                className="rounded-full border border-line-strong px-2.5 py-[4px] text-[10px] text-dim"
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Capacity-gated request — the red moment */}
        <BlockCard tone="red" className="mb-4 mt-auto">
          <div className="flex items-baseline justify-between">
            <AppEyebrow onBlock>Capacity</AppEyebrow>
            <span className="text-[13px] font-bold text-ink">2 spots left</span>
          </div>
          <BlockPill className="mt-3 w-full">Request coaching</BlockPill>
        </BlockCard>
      </div>
    </AppScreen>
  );
}
