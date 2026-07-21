'use client';

/**
 * Mock: GM Meals partner-kitchen menu — category chips, three macro-labelled
 * meal cards, and an add-to-cart loop (badge increments, mini toast pops).
 */
import { useStepLoop } from '../motion';
import { AppEyebrow, AppScreen, AppTabBar, AppTitle, BlockCard, MetaChip } from './appkit';

const MEALS = [
  { name: 'Paneer power bowl', kcal: '580 kcal', protein: '42 g protein', price: 'Rs 490' },
  { name: 'Chicken quinoa bowl', kcal: '560 kcal', protein: '45 g protein', price: 'Rs 520' },
  { name: 'Veg thali · cut', kcal: '480 kcal', protein: '28 g protein', price: 'Rs 380' },
] as const;

const CATEGORIES = ['High protein', 'Veg', 'Keto'] as const;

export function MenuBrowseScreen() {
  // Adds fire at steps 1 / 3 / 5; step 0 resets; step 6 rests with a full cart.
  const [ref, step] = useStepLoop(7, 1250, 6);
  const count = step >= 5 ? 3 : step >= 3 ? 2 : step >= 1 ? 1 : 0;
  const toastVisible = step === 1 || step === 3 || step === 5;
  const lastAdded = count > 0 ? MEALS[count - 1].name : '';

  return (
    <AppScreen>
      <div ref={ref} className="flex flex-1 flex-col gap-3 px-5 pt-1">
        {/* Kitchen header + cart */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <AppEyebrow>GM Meals · Jhamsikhel</AppEyebrow>
            <AppTitle className="mt-1">
              Himalaya
              <br />
              Bowl Kitchen
            </AppTitle>
          </div>
          <span className="relative mt-6 flex size-11 shrink-0 items-center justify-center rounded-full bg-charcoal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 9V7a5 5 0 0 1 10 0v2h3.2l-1.4 12.2A2 2 0 0 1 16.8 23H7.2a2 2 0 0 1-2-1.8L3.8 9H7Zm2 0h6V7a3 3 0 0 0-6 0v2Z" />
            </svg>
            <span
              className={`absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red text-[10px] font-bold text-ink transition-transform duration-300 ${
                count > 0 ? 'scale-100' : 'scale-0'
              }`}
            >
              {count > 0 ? count : ''}
            </span>
          </span>
        </div>

        <div className="flex gap-2">
          <MetaChip>Cutoff 10:00 AM</MetaChip>
          <MetaChip>Delivers 12–1 PM</MetaChip>
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5">
          {CATEGORIES.map((c, i) => (
            <span
              key={c}
              className={`inline-flex h-[30px] items-center rounded-full px-3.5 text-[11px] font-semibold ${
                i === 0 ? 'bg-snow text-ink' : 'border border-line-strong text-dim'
              }`}
            >
              {c}
            </span>
          ))}
        </div>

        {/* Meal cards — first is the red featured block */}
        {MEALS.map((meal, i) => {
          const added = count > i;
          const featured = i === 0;
          return featured ? (
            <BlockCard key={meal.name} tone="red" className="py-3.5">
              <div className="flex items-baseline justify-between">
                <AppEyebrow onBlock>Kitchen pick</AppEyebrow>
                <span className="font-display text-[16px] font-medium text-ink">{meal.price}</span>
              </div>
              <p className="mt-1 text-[15px] font-bold leading-tight text-ink">{meal.name}</p>
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[10px] font-semibold text-ink">
                  {meal.kcal}
                </span>
                <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[10px] font-semibold text-ink">
                  {meal.protein}
                </span>
                <span
                  className={`ml-auto flex size-9 items-center justify-center rounded-full bg-ink text-[15px] font-bold text-snow transition-transform duration-300 ${
                    added ? 'scale-100' : 'scale-95'
                  }`}
                >
                  {added ? '✓' : '+'}
                </span>
              </div>
            </BlockCard>
          ) : (
            <BlockCard key={meal.name} tone="charcoal" className="py-3.5">
              <div className="flex items-baseline justify-between">
                <p className="text-[14px] font-bold leading-tight text-snow">{meal.name}</p>
                <span className="font-display text-[15px] font-medium text-snow">{meal.price}</span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="rounded-full bg-charcoal-2 px-2.5 py-1 text-[10px] font-semibold text-dim">
                  {meal.kcal}
                </span>
                <span className="rounded-full bg-charcoal-2 px-2.5 py-1 text-[10px] font-semibold text-dim">
                  {meal.protein}
                </span>
                <span
                  className={`ml-auto flex size-9 items-center justify-center rounded-full text-[15px] font-bold transition-all duration-300 ${
                    added ? 'bg-red text-ink' : 'bg-charcoal-2 text-snow'
                  }`}
                >
                  {added ? '✓' : '+'}
                </span>
              </div>
            </BlockCard>
          );
        })}
      </div>

      {/* Mini toast above the tab bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-[86px] z-20 flex justify-center transition-all duration-300 ${
          toastVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        <span className="rounded-full bg-cream px-4 py-2 text-[11.5px] font-semibold text-ink shadow-pop">
          Added — {lastAdded}
        </span>
      </div>
      <AppTabBar active="meals" />
    </AppScreen>
  );
}
