/**
 * Meal-delivery pure logic — cutoff resolution, fee computation, availability,
 * and the Asia/Kathmandu calendar helpers the engine shares. No I/O, no npm tz
 * dependency (CLAUDE.md rule 10, plan §3/§8).
 *
 * Timezone: Nepal is a FIXED UTC+05:45 with NO daylight saving, so every KTM
 * wall-clock ↔ UTC conversion is a constant 345-minute shift. All `deliveryDate`
 * / date strings are `YYYY-MM-DD` in the KTM calendar; all `Date` instants are
 * true UTC instants. Cutoffs are frozen onto the order row at creation and never
 * re-resolved (correctness invariant §8a).
 */

/** Fixed Asia/Kathmandu offset ahead of UTC, in minutes (5h45m). */
export const KTM_OFFSET_MINUTES = 345;
const KTM_OFFSET_MS = KTM_OFFSET_MINUTES * 60_000;

/** Cutoff hours — DEFAULTS only; the admin-editable `meal_delivery_config` row
 * (loaded server-side) overrides these when passed as the optional `hours` arg. */
export const LUNCH_CUTOFF_PREV_DAY_HOUR = 21; // 21:00 the day BEFORE delivery
export const DINNER_CUTOFF_SAME_DAY_HOUR = 10; // 10:00 the SAME day as delivery

/**
 * The admin-tunable cutoff hours (subset of `MealDeliveryConfig`). Passing this
 * makes `cutoffFor` (and the helpers built on it) honor the operator-edited
 * `meal_delivery_config.lunchCutoffPrevDayHour / dinnerCutoffSameDayHour`
 * instead of the frozen module defaults. Omitting it keeps the historical
 * fixed-21:00/10:00 behavior (so every §8 call site stays valid).
 */
export interface CutoffHours {
  lunchCutoffPrevDayHour: number;
  dinnerCutoffSameDayHour: number;
}

/** The frozen fixed-cutoff defaults used when no config is supplied. */
export const DEFAULT_CUTOFF_HOURS: CutoffHours = {
  lunchCutoffPrevDayHour: LUNCH_CUTOFF_PREV_DAY_HOUR,
  dinnerCutoffSameDayHour: DINNER_CUTOFF_SAME_DAY_HOUR,
};

export type MealWindow = 'lunch' | 'dinner';
export type MealDietType = 'veg' | 'non_veg' | 'egg';
export type MealGoalTag = 'cutting' | 'bulking' | 'balanced';
export type MealCurrency = 'NPR' | 'USD';
export type MealPaymentMethod = 'esewa' | 'khalti' | 'cod';

export const MEAL_WINDOWS: readonly MealWindow[] = ['lunch', 'dinner'];
export const MEAL_GOAL_TAGS: readonly MealGoalTag[] = ['cutting', 'bulking', 'balanced'];

/**
 * Display windows (KTM wall-clock strings) — the actual delivery time bands,
 * distinct from the ordering cutoffs above.
 */
export const MEAL_WINDOW_TIMES: Record<MealWindow, { start: string; end: string }> = {
  lunch: { start: '11:00', end: '13:00' },
  dinner: { start: '18:00', end: '20:00' },
};

/** Server-authoritative fee + cutoff parameters (mirrors the singleton row). */
export interface MealDeliveryConfig {
  smallOrderFeeMinor: number;
  smallOrderThresholdMinor: number;
  deliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number;
  lunchCutoffPrevDayHour: number;
  dinnerCutoffSameDayHour: number;
}

/** Defaults matching the `meal_delivery_config` singleton (paisa; Rs = ×100). */
export const DEFAULT_MEAL_DELIVERY_CONFIG: MealDeliveryConfig = {
  smallOrderFeeMinor: 5000, // Rs50
  smallOrderThresholdMinor: 50000, // Rs500
  deliveryFeeMinor: 5000, // Rs50 flat
  freeDeliveryThresholdMinor: 100000, // Rs1000
  lunchCutoffPrevDayHour: LUNCH_CUTOFF_PREV_DAY_HOUR,
  dinnerCutoffSameDayHour: DINNER_CUTOFF_SAME_DAY_HOUR,
};

// --- KTM calendar helpers (exported; reused by the order engine) -------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse a `YYYY-MM-DD` KTM date into numeric parts (month is 1-based). */
function parseDateStr(dateStr: string): { y: number; mo: number; da: number } {
  const [y, mo, da] = dateStr.split('-').map((p) => Number(p));
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(da)) {
    throw new Error(`invalid date string: ${dateStr}`);
  }
  return { y, mo, da };
}

/** The UTC instant of a KTM wall-clock time (month 1-based). */
function ktmWallToUtc(y: number, mo1: number, da: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, mo1 - 1, da, hh, mm) - KTM_OFFSET_MS);
}

/** The KTM calendar date (`YYYY-MM-DD`) that a UTC instant falls on. */
export function ktmDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + KTM_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** `dateStr` shifted by `n` calendar days (KTM), normalized across month/year. */
export function ktmAddDays(dateStr: string, n: number): string {
  const { y, mo, da } = parseDateStr(dateStr);
  const d = new Date(Date.UTC(y, mo - 1, da + n));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Day of week for a KTM date: 0=Sunday … 6=Saturday. */
export function ktmDayOfWeek(dateStr: string): number {
  const { y, mo, da } = parseDateStr(dateStr);
  return new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
}

// --- Cutoffs -----------------------------------------------------------------

/**
 * The ordering cutoff instant for a delivery slot:
 *   lunch  → `lunchCutoffPrevDayHour`:00 KTM the PREVIOUS day (default 21:00)
 *   dinner → `dinnerCutoffSameDayHour`:00 KTM the SAME day (default 10:00)
 * A slot is orderable iff `now < cutoffFor(date, window)`. Frozen onto the order
 * at creation. `tz` is accepted for signature stability but only the fixed
 * Asia/Kathmandu offset is supported (Nepal has no DST). `hours` (optional 4th
 * arg) applies the admin-edited `meal_delivery_config` cutoff hours; omit it and
 * the frozen 21:00/10:00 defaults apply (so all §8 call sites remain valid).
 */
export function cutoffFor(
  deliveryDate: string,
  window: MealWindow,
  _tz: string = 'Asia/Kathmandu',
  hours: CutoffHours = DEFAULT_CUTOFF_HOURS,
): Date {
  const { y, mo, da } = parseDateStr(deliveryDate);
  if (window === 'lunch') {
    return ktmWallToUtc(y, mo, da - 1, hours.lunchCutoffPrevDayHour, 0);
  }
  return ktmWallToUtc(y, mo, da, hours.dinnerCutoffSameDayHour, 0);
}

/** True iff `now` is before the slot's cutoff (slot still orderable/mutable). */
export function isSlotOrderable(
  deliveryDate: string,
  window: MealWindow,
  now: Date,
  hours: CutoffHours = DEFAULT_CUTOFF_HOURS,
): boolean {
  return now.getTime() < cutoffFor(deliveryDate, window, 'Asia/Kathmandu', hours).getTime();
}

/**
 * The first slot still orderable at `now`, scanning chronologically from today
 * (KTM). Never hardcodes "tomorrow" — the two cutoff rules interleave so this
 * walks (date asc, lunch before dinner), which is exactly cutoff-ascending.
 */
export function earliestOrderableSlot(
  now: Date,
  hours: CutoffHours = DEFAULT_CUTOFF_HOURS,
): { date: string; window: MealWindow } {
  let date = ktmDateString(now);
  for (let i = 0; i < 8; i += 1) {
    for (const window of MEAL_WINDOWS) {
      if (isSlotOrderable(date, window, now, hours)) return { date, window };
    }
    date = ktmAddDays(date, 1);
  }
  // Unreachable in practice (a slot 7+ days out is always orderable).
  return { date, window: 'lunch' };
}

// --- Fees --------------------------------------------------------------------

/**
 * Server-authoritative fee computation. Small-order surcharge when subtotal is
 * below the threshold; flat delivery fee waived at/above the free threshold.
 * The client never sets fees.
 */
export function computeFees(
  subtotalMinor: number,
  cfg: MealDeliveryConfig = DEFAULT_MEAL_DELIVERY_CONFIG,
): { deliveryFeeMinor: number; smallOrderFeeMinor: number; totalMinor: number } {
  const smallOrderFeeMinor =
    subtotalMinor < cfg.smallOrderThresholdMinor ? cfg.smallOrderFeeMinor : 0;
  const deliveryFeeMinor =
    subtotalMinor >= cfg.freeDeliveryThresholdMinor ? 0 : cfg.deliveryFeeMinor;
  return {
    deliveryFeeMinor,
    smallOrderFeeMinor,
    totalMinor: subtotalMinor + deliveryFeeMinor + smallOrderFeeMinor,
  };
}

// --- Availability ------------------------------------------------------------

export interface MealAvailabilitySlot {
  dayOfWeek: number;
  window: MealWindow;
}

/**
 * Is a meal orderable on a given (dayOfWeek, window)? A meal with NO availability
 * rows is treated as always-available; otherwise it must have a matching row
 * (partner opt-in narrowing).
 */
export function isMealAvailableOn(
  availability: readonly MealAvailabilitySlot[],
  dayOfWeek: number,
  window: MealWindow,
): boolean {
  if (availability.length === 0) return true;
  return availability.some((a) => a.dayOfWeek === dayOfWeek && a.window === window);
}

/** Is a meal orderable for a KTM delivery date + window given its availability? */
export function isMealAvailableForDate(
  availability: readonly MealAvailabilitySlot[],
  deliveryDate: string,
  window: MealWindow,
): boolean {
  return isMealAvailableOn(availability, ktmDayOfWeek(deliveryDate), window);
}
