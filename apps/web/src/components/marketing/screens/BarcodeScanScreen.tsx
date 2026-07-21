'use client';

/**
 * Mock: barcode scanner — a live camera feed (dim photo), corner brackets
 * tightly framing the barcode, a sweeping red scan line, then a staged loop:
 * scan → matched → product card slides up → added to lunch → reset.
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar } from './appkit';

// EAN-ish bar pattern (widths in px at the sticker's design size).
const BARS = [
  2, 1, 3, 1, 1, 2, 1, 4, 2, 1, 1, 3, 2, 1, 2, 1, 1, 2, 3, 1, 2, 1, 4, 1, 1, 2, 1, 2, 3, 1, 1, 2,
  2, 1, 1, 3, 1, 2, 1, 1,
];

export function BarcodeScanScreen() {
  // 0-1 scanning · 2 matched · 3-4 card up · 5 added · 6 reset beat
  const [ref, step] = useStepLoop(7, 1150, 4);
  const matched = step >= 2 && step <= 5;
  const cardUp = step >= 3 && step <= 5;
  const added = step === 5;

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col px-5 pt-1">
        <div>
          <AppEyebrow>Food · Scan to log</AppEyebrow>
          <h3 className="mt-1 font-display text-[30px] font-medium uppercase leading-none">
            Scan
          </h3>
        </div>

        {/* Camera viewfinder */}
        <div className="relative mt-3 flex-1 overflow-hidden rounded-[22px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/stock/food-bowl.jpg"
            alt=""
            className="absolute inset-0 size-full scale-110 object-cover opacity-45 blur-[2px]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/70" />

          {/* Scan zone — brackets hug the barcode */}
          <div className="absolute left-1/2 top-[54%] w-[228px] -translate-x-1/2 -translate-y-1/2">
            <div className="relative px-3 py-5">
              {/* Corner brackets */}
              {(
                [
                  ['left-0 top-0', 'border-l-[3px] border-t-[3px] rounded-tl-md'],
                  ['right-0 top-0', 'border-r-[3px] border-t-[3px] rounded-tr-md'],
                  ['bottom-0 left-0', 'border-b-[3px] border-l-[3px] rounded-bl-md'],
                  ['bottom-0 right-0', 'border-b-[3px] border-r-[3px] rounded-br-md'],
                ] as const
              ).map(([pos, edges]) => (
                <span
                  key={pos}
                  className={`absolute size-7 transition-colors duration-300 ${pos} ${edges} ${
                    matched ? 'border-mint' : 'border-snow/80'
                  }`}
                />
              ))}

              {/* Barcode sticker */}
              <div className="mx-auto w-[196px] rounded-[12px] bg-white px-4 pb-2.5 pt-3.5 shadow-pop">
                <svg width="164" height="52" viewBox="0 0 164 52" aria-hidden className="mx-auto">
                  {(() => {
                    let x = 0;
                    return BARS.map((w, i) => {
                      const bar = (
                        <rect
                          key={i}
                          x={x}
                          y={0}
                          width={w * 2}
                          height={i % 7 === 0 ? 52 : 46}
                          fill="#101214"
                        />
                      );
                      x += w * 2 + 2;
                      return bar;
                    });
                  })()}
                </svg>
                <p className="mt-1.5 text-center font-mono text-[10px] tracking-[0.2em] text-[#3a3d42]">
                  9 771234 567003
                </p>
              </div>

              {/* Sweeping scan line */}
              {!matched ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 top-4 h-[3px] rounded-full bg-red shadow-ember"
                  style={{ animation: 'mkt-scan 1.7s ease-in-out infinite' }}
                />
              ) : null}
            </div>
          </div>

          {/* Match chip — appears at the moment of the match */}
          <div
            className={`absolute inset-x-0 top-4 flex justify-center transition-all duration-300 ${
              matched ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
            }`}
          >
            <span className="flex items-center gap-1.5 rounded-full bg-ink/85 px-3.5 py-1.5 font-display text-[10.5px] font-medium uppercase tracking-[0.16em] text-mint backdrop-blur-sm">
              ✓ Matched · Open Food Facts
            </span>
          </div>

          {/* Product card slides up over the feed */}
          <div
            className={`absolute inset-x-2.5 bottom-2.5 rounded-[18px] bg-cream p-4 transition-all duration-500 ease-out ${
              cardUp ? 'translate-y-0 opacity-100' : 'translate-y-[115%] opacity-0'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14.5px] font-bold leading-tight text-ink">
                  Peanut Choco Protein Bar
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-cream-dim">Per bar · 45 g</p>
              </div>
              <div className="text-center">
                <span className="flex size-9 items-center justify-center rounded-[10px] bg-gold font-display text-[17px] font-medium text-ink">
                  B
                </span>
                <p className="mt-1 font-mono text-[7.5px] uppercase tracking-[0.14em] text-cream-dim">
                  Nutri-Score
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-display text-[26px] font-medium leading-none text-ink">228</span>
              <span className="font-display text-[10px] uppercase tracking-[0.14em] text-cream-dim">
                kcal
              </span>
              <span className="ml-auto flex gap-1.5">
                {(
                  [
                    ['P 20 g', 'text-blue'],
                    ['C 18 g', 'text-orange'],
                    ['F 9 g', 'text-gold'],
                  ] as const
                ).map(([m, color]) => (
                  <span
                    key={m}
                    className={`rounded-full bg-ink/8 px-2.5 py-1 text-[10px] font-bold ${color}`}
                  >
                    {m}
                  </span>
                ))}
              </span>
            </div>
            <div
              className={`mt-3 flex h-[42px] items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-300 ${
                added ? 'bg-mint text-ink' : 'bg-ink text-snow'
              }`}
            >
              {added ? '✓ Added to lunch' : 'Add to lunch'}
            </div>
          </div>
        </div>

        <div className="h-[86px] shrink-0" />
      </div>
      <AppTabBar active="food" />
    </AppScreen>
  );
}
