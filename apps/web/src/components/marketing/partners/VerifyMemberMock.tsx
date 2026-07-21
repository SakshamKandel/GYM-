'use client';

/**
 * Partner-portal mock: the Verify Member tool — a member code auto-types into
 * the input, then the result card flips in with first name / tier / validity
 * only. Rendered on a light card (parent supplies the white surface).
 */
import { useStepLoop } from '../motion';

const CODE = 'GMMB-4X2K';

export function VerifyMemberMock() {
  // Steps 0–9 type the code, result flips in at 11, holds, then loops.
  const [ref, step] = useStepLoop(16, 260, 13);
  const typed = CODE.slice(0, Math.min(step, CODE.length));
  const showResult = step >= 11;

  return (
    <div ref={ref} className="text-[#1b1c1e]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#5f636a]">
          Verify member
        </p>
        <span className="rounded-full bg-[#eef1f4] px-2 py-0.5 text-[9px] font-semibold text-[#5f636a]">
          In-restaurant
        </span>
      </div>

      {/* Code input + button */}
      <div className="mt-3 flex gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-[#e7e6e1] bg-[#f5f5f2] px-3 font-mono text-[13px] font-medium tracking-[0.1em] text-[#1b1c1e]">
          {typed}
          <span
            aria-hidden
            className={`ml-0.5 h-4 w-[2px] shrink-0 bg-[#f0521e] ${showResult ? 'opacity-0' : 'animate-pulse'}`}
          />
        </div>
        <span className="flex h-10 shrink-0 items-center rounded-lg bg-[#f0521e] px-4 text-[11.5px] font-bold text-white">
          Verify
        </span>
      </div>

      {/* Result card — flips in */}
      <div className="mt-3 h-[72px]" style={{ perspective: '700px' }}>
        <div
          className="flex h-full items-center gap-3 rounded-xl bg-[#e8f7ee] px-4 transition-all duration-500"
          style={{
            transform: showResult ? 'rotateX(0deg)' : 'rotateX(-80deg)',
            opacity: showResult ? 1 : 0,
            transformOrigin: 'top center',
          }}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#17a34a] text-[13px] font-bold text-white">
            ✓
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold">Saksham</span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="rounded-full bg-[#fdf3d7] px-2 py-0.5 text-[9px] font-bold tracking-[0.06em] text-[#92400e]">
                GOLD
              </span>
              <span className="text-[10px] font-medium text-[#5f636a]">Valid thru Aug 2026</span>
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-bold text-[#17a34a]">Discount OK</span>
        </div>
      </div>

      <p className="mt-3 text-[9.5px] leading-relaxed text-[#9a9ea6]">
        First name · tier · validity — nothing else. Unknown codes get a uniform &ldquo;not
        found&rdquo;.
      </p>
    </div>
  );
}
