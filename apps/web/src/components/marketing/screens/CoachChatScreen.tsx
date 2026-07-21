'use client';

/**
 * Mock: coach chat — messages land in sequence, with the real PII-guard
 * moment (server-side masking) surfaced as a system chip.
 */
import { useStepLoop } from '../motion';
import { AppScreen, AvatarDot } from './appkit';

type Msg =
  | { kind: 'coach' | 'member'; text: string }
  | { kind: 'system'; text: string };

const THREAD: Msg[] = [
  { kind: 'coach', text: 'Form check on that last squat set?' },
  { kind: 'member', text: 'Sent the video. Felt heavy at the bottom 😅' },
  { kind: 'coach', text: 'Depth is perfect. Brace earlier — add 2.5 kg on Friday.' },
  { kind: 'system', text: 'Personal contact details are auto-hidden · PII guard' },
  { kind: 'member', text: 'Done. Logging it now 💪' },
];

export function CoachChatScreen() {
  const [ref, step] = useStepLoop(THREAD.length + 3, 1200, THREAD.length);
  const visible = Math.min(step + 1, THREAD.length);

  return (
    <AppScreen>
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-charcoal px-5 pb-3 pt-1">
        <AvatarDot letter="G" />
        <div className="flex-1">
          <p className="text-[14px] font-bold leading-tight">Coach Gaurav</p>
          <p className="text-[11px] text-dim">Strength · replies in ~2 h</p>
        </div>
        <span className="rounded-full bg-gold/15 px-2.5 py-1 font-display text-[10px] font-medium uppercase tracking-[0.14em] text-gold">
          Gold coach
        </span>
      </div>

      <div ref={ref} className="flex flex-1 flex-col justify-end gap-2.5 px-5 pb-5 pt-4">
        {THREAD.slice(0, visible).map((m, i) => {
          if (m.kind === 'system') {
            return (
              <div key={i} className="mkt-reveal is-in flex justify-center">
                <span className="flex items-center gap-1.5 rounded-full bg-charcoal px-3.5 py-1.5 text-[10.5px] font-medium text-dim">
                  <svg width="11" height="12" viewBox="0 0 12 14" fill="#9BA0A8">
                    <path d="M6 0 12 2.5v4C12 10.5 9.5 13 6 14 2.5 13 0 10.5 0 6.5v-4L6 0Z" />
                  </svg>
                  {m.text}
                </span>
              </div>
            );
          }
          const isCoach = m.kind === 'coach';
          return (
            <div key={i} className={`mkt-reveal is-in flex ${isCoach ? '' : 'justify-end'}`}>
              <span
                className={`max-w-[78%] rounded-[18px] px-4 py-2.5 text-[13px] leading-snug ${
                  isCoach
                    ? 'rounded-bl-md bg-charcoal text-snow'
                    : 'rounded-br-md bg-red font-medium text-ink'
                }`}
              >
                {m.text}
              </span>
            </div>
          );
        })}

        {/* typing dots while the loop is mid-thread */}
        {visible < THREAD.length ? (
          <div className="flex">
            <span className="flex items-center gap-1 rounded-[18px] rounded-bl-md bg-charcoal px-4 py-3">
              {[0, 1, 2].map((d) => (
                <span key={d} className="size-1.5 rounded-full bg-faint" />
              ))}
            </span>
          </div>
        ) : null}

        {/* Composer */}
        <div className="mt-2 flex h-[46px] items-center gap-3 rounded-full bg-charcoal px-5">
          <span className="flex-1 text-[13px] text-faint">Message your coach…</span>
          <span className="flex size-8 items-center justify-center rounded-full bg-red">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#0B0C0D">
              <path d="M3 11 21 3l-8 18-2.5-7.5L3 11Z" />
            </svg>
          </span>
        </div>
      </div>
    </AppScreen>
  );
}
