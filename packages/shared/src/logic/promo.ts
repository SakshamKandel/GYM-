/**
 * Promo code generation + normalization — shared by coach-application
 * approval (auto-generates each verified coach's code), the admin house-code
 * creator, and the member redemption form. Pure logic, no I/O (CLAUDE.md rule
 * 10) — DB uniqueness/collision-retry lives at the route level (SCALE-UP-PLAN
 * §1.3: "collision-retry" — callers re-invoke `generatePromoCode` on a
 * unique-constraint conflict).
 */

const FALLBACK_BASE = 'COACH';
const MIN_BASE_LEN = 4;
const MAX_BASE_LEN = 10;
const DIGIT_COUNT = 2;

/**
 * Generate a promo code from a coach's name: uppercase letters only from
 * `name` (falls back to "COACH" when the name has no letters), clamped to
 * 4–10 characters, plus 2 random digits — 6 to 12 characters total, always
 * `[A-Z0-9]`.
 */
export function generatePromoCode(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  let base = letters.length > 0 ? letters : FALLBACK_BASE;
  if (base.length > MAX_BASE_LEN) base = base.slice(0, MAX_BASE_LEN);
  while (base.length < MIN_BASE_LEN) {
    base += FALLBACK_BASE[base.length % FALLBACK_BASE.length];
  }
  const digits = String(Math.floor(Math.random() * 10 ** DIGIT_COUNT)).padStart(
    DIGIT_COUNT,
    '0',
  );
  return `${base}${digits}`;
}

/** Codes must be uppercase alphanumeric, 4–16 characters. */
const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/**
 * Normalize member-entered or admin-entered promo code input: trim,
 * uppercase, then validate against `[A-Z0-9]{4,16}`. Returns the normalized
 * code, or `null` when the input doesn't validate (empty, too short/long, or
 * contains characters outside A-Z0-9).
 */
export function normalizePromoCode(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  return PROMO_CODE_PATTERN.test(normalized) ? normalized : null;
}
