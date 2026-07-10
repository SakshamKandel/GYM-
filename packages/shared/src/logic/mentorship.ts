/**
 * Mentorship (coach ↔ trainee) shared logic: the specialty catalog shown in
 * coach portfolios / discovery filters, and the PII mask that keeps all
 * coach–member communication inside the app.
 */

/** Curated specialty tags — coaches pick from these, members filter by them.
 * A fixed catalog keeps discovery filters meaningful (no free-text drift). */
export const COACH_SPECIALTIES = [
  'strength',
  'hypertrophy',
  'fat loss',
  'powerlifting',
  'bodybuilding',
  'calisthenics',
  'mobility',
  'nutrition',
  'rehab',
  'contest prep',
  'beginners',
  'womens training',
] as const;

export type CoachSpecialty = (typeof COACH_SPECIALTIES)[number];

export function isCoachSpecialty(value: string): value is CoachSpecialty {
  return (COACH_SPECIALTIES as readonly string[]).includes(value);
}

// ── PII masking ────────────────────────────────────────────────
//
// Policy: coach–member communication stays inside the app. Server-side, every
// message body is masked BEFORE storage, so leaked contact details never even
// reach the database — no client can opt out.

/** Email addresses — local@domain.tld, case-insensitive. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Phone-like number runs: 7+ digits allowing spaces/dashes/dots/parens
 * between them, with an optional leading +. Written to spare gym numbers —
 * weights ("102.5"), reps ("5x5"), years and kcal all stay under 7 digits.
 */
const PHONE_RE = /\+?\(?\d(?:[\s\-.()]{0,2}\d){6,}\)?/g;

/**
 * Social handles pointing off-app: @name on its own (not an email — emails
 * are already gone by the time this runs) preceded by whitespace/start.
 */
const HANDLE_RE = /(^|[\s:])@[A-Za-z0-9_.]{3,}/g;

export const PII_MASK = '[hidden — keep chat in the app]';

/**
 * Masks emails, phone numbers and social handles in a message body.
 * Idempotent; preserves surrounding text. Order matters: emails first (their
 * digits/handles must not partially match the later passes).
 */
export function maskPii(body: string): string {
  return body
    .replace(EMAIL_RE, PII_MASK)
    .replace(PHONE_RE, PII_MASK)
    .replace(HANDLE_RE, (_m, prefix: string) => `${prefix}${PII_MASK}`);
}

/** True when masking changed the body — callers can tell the sender. */
export function containsPii(body: string): boolean {
  return maskPii(body) !== body;
}
