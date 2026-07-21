'use client';

/**
 * Mock: a coach logging a client milestone from the app — form fills itself
 * on a loop, the red publish block fires, and the entry lands on the client's
 * portfolio with a quiet tick. No confetti, no pulsing.
 *
 * Detail screen (pushed from the coach console) — no tab bar, like the real
 * coach flows and the CoachChatScreen exemplar.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AvatarDot, BlockCard, BlockPill, MetaChip } from './appkit';

const PORTFOLIO = [
  { title: 'First strict pull-up', when: 'Jun 30' },
  { title: '−6 kg cut in 10 weeks', when: 'May 18' },
] as const;

export function CoachMilestoneScreen() {
  const [ref, step] = useStepLoop(7, 1050, 5);
  const typed = step >= 2 ? 'First 100 kg squat' : step >= 1 ? 'First 100 k' : '';
  const noted = step >= 3;
  const published = step >= 5;

  return (
    <AppScreen>
      {/* pushed-screen header */}
      <div className="flex items-center gap-3 border-b border-charcoal px-5 pb-3 pt-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-charcoal">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9BA0A8" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 5 8 12l7 7" />
          </svg>
        </span>
        <div className="flex-1">
          <p className="text-[14px] font-bold leading-tight">Log milestone</p>
          <p className="text-[11px] text-dim">Coach console</p>
        </div>
        <MetaChip>Coach</MetaChip>
      </div>

      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-4">
        {/* client card */}
        <div className="flex min-h-[58px] items-center gap-3 rounded-[16px] bg-charcoal px-4 py-3">
          <AvatarDot letter="A" tone="cream" />
          <span className="flex-1">
            <span className="block text-[13.5px] font-semibold leading-tight">Anisha S.</span>
            <span className="block text-[11px] text-dim">Strength block · week 9</span>
          </span>
          <MetaChip>Client</MetaChip>
        </div>

        {/* milestone form */}
        <BlockCard tone="raised">
          <AppEyebrow>Milestone</AppEyebrow>
          <div className="mt-2 flex h-[44px] items-center rounded-[12px] bg-charcoal px-4">
            {typed ? (
              <span className="flex items-center text-[14px] font-semibold">
                {typed}
                {!published && step < 3 ? (
                  <span aria-hidden className="ml-0.5 h-[17px] w-[2px] rounded-full bg-red" />
                ) : null}
              </span>
            ) : (
              <span className="text-[13px] text-faint">e.g. First 100 kg squat</span>
            )}
          </div>
          <AppEyebrow className="mt-3.5">Note</AppEyebrow>
          <div
            className={`mt-2 flex h-[38px] items-center rounded-[12px] bg-charcoal px-4 transition-opacity duration-500 ${
              noted ? 'opacity-100' : 'opacity-45'
            }`}
          >
            <span className={`text-[12px] ${noted ? 'text-snow/85' : 'text-faint'}`}>
              {noted ? 'Paused reps, belt only. Huge day.' : 'Add a note…'}
            </span>
          </div>
        </BlockCard>

        {/* red publish block — the screen's single red moment */}
        <BlockCard tone="red">
          <AppEyebrow onBlock>Publish</AppEyebrow>
          <p className="mt-1 text-[12.5px] font-medium leading-snug text-ink/75">
            Lands on Anisha&rsquo;s Progress portfolio — and on yours.
          </p>
          <BlockPill className="mt-3 w-full">
            {published ? (
              <span className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F5F6F7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12.5 9.5 18 20 6.5" />
                </svg>
                Published
              </span>
            ) : (
              'Publish to portfolio'
            )}
          </BlockPill>
        </BlockCard>

        {/* client portfolio — the new entry slides in on publish */}
        <BlockCard tone="charcoal" className="py-3.5">
          <div className="flex items-baseline justify-between">
            <AppEyebrow>Anisha&rsquo;s portfolio</AppEyebrow>
            <span className="font-display text-[12px] font-medium text-dim">
              {published ? '3' : '2'} milestones
            </span>
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            <div
              className={`overflow-hidden transition-all duration-500 ease-out ${
                published ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="flex items-center gap-2.5 rounded-[12px] bg-charcoal-2 px-3 py-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red text-[10px] font-bold text-ink">
                  ✓
                </span>
                <span className="flex-1 truncate text-[12px] font-semibold">First 100 kg squat</span>
                <span className="text-[10.5px] text-dim">Today</span>
              </div>
            </div>
            {PORTFOLIO.map((m) => (
              <div key={m.title} className="flex items-center gap-2.5 rounded-[12px] bg-charcoal-2 px-3 py-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-charcoal-3 text-[10px] font-bold text-dim">
                  ✓
                </span>
                <span className="flex-1 truncate text-[12px] font-medium text-snow/85">{m.title}</span>
                <span className="text-[10.5px] text-dim">{m.when}</span>
              </div>
            ))}
          </div>
        </BlockCard>
      </div>
    </AppScreen>
  );
}
