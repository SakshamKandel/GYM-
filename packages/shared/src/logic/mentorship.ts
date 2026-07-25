/**
 * Mentorship (coach ↔ trainee) shared logic: the specialty catalog shown in
 * coach portfolios / discovery filters, and the PII mask that keeps
 * coach–member contact details inside the app.
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
// Policy: coach–member contact details stay inside the app. Server-side, the
// coach-chat body is masked BEFORE storage, so a phone number or an email
// address never even reaches the database and no client can opt out.
//
// Be honest about the ceiling. What deterministic rules over one message body
// CAN do: make a casual, in-the-moment swap ("here's my number, text me")
// take real effort, and leave a visible hole in the conversation that the
// member, the coach and anyone reviewing the thread can all see. They catch
// the evasions people actually reach for first: spaced, dashed or dotted
// digits, full-width and non-Latin digits, zero-width characters wedged
// between them, "name at gmail dot com", letters standing in for digits,
// spelled-out digits, and links to the usual off-app platforms.
//
// What they CANNOT do: stop two people who agree a code in advance. "Same as
// my locker number", a number split across three messages a week apart, or a
// nickname they both already know will pass, and no rule reading a single
// message can tell otherwise. The goal is friction and visibility, not a
// guarantee. Catching arranged hand-offs needs behaviour-level signals (a
// member who cancels days after a burst of odd messages), which is a
// different system than this one.
//
// The false-positive side matters just as much. This is a gym app: bodies are
// full of legitimate numbers — warm-up ladders, rep schemes, plate maths,
// dates, prices. A mask that eats "40 50 60 70 80 90 100" is worse than no
// mask at all, because coaches stop trusting it. So the phone rule asks for a
// realistic phone SHAPE (a handful of groups, at most one very short one)
// rather than counting digits.
//
// How it works: every detector runs over a NORMALISED COPY of the body
// (NFKC, Unicode decimal digits folded to ASCII, zero-width characters
// dropped, lower-cased, and a second copy with look-alike letters folded to
// digits), while each mask is spliced into the ORIGINAL by index. Text that
// survives keeps its exact spelling, casing and spacing.

export const PII_MASK = '[hidden, keep chat in the app]';

// ── Normalisation ──────────────────────────────────────────────

/** Characters with no visible width — wedged between digits to break naive regexes. */
const INVISIBLE_RE = new RegExp(
  '[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F\\uFEFF]',
);

/**
 * Code point of "digit zero" for the Unicode decimal blocks we fold to ASCII.
 * NFKC already handles full-width, circled, superscript and mathematical
 * digits; these are the blocks it deliberately leaves alone.
 */
const DECIMAL_ZEROS: readonly number[] = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6,
  0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
  0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
  0xff10, 0x104a0, 0x16a60, 0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6,
];

/** The ASCII digit a code point stands for, or null when it is not a decimal digit. */
function asciiDigit(codePoint: number): string | null {
  for (const zero of DECIMAL_ZEROS) {
    if (codePoint >= zero && codePoint <= zero + 9) return String(codePoint - zero);
  }
  return null;
}

interface Normalised {
  /** The text every detector reads. */
  text: string;
  /** Original start offset of normalised character i. */
  starts: number[];
  /** Original end offset (exclusive) of normalised character i. */
  ends: number[];
}

/**
 * Build the detection copy alongside a per-character map back to the original.
 * NFKC can turn one character into several and invisible characters vanish
 * entirely, so the map is kept explicitly rather than assuming equal lengths.
 */
function normalise(original: string): Normalised {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  for (let i = 0; i < original.length; ) {
    const codePoint = original.codePointAt(i);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    const raw = String.fromCodePoint(codePoint);

    if (!INVISIBLE_RE.test(raw)) {
      const digit = asciiDigit(codePoint);
      const expanded = digit ?? raw.normalize('NFKC').toLowerCase();
      for (const piece of expanded) {
        const pieceCode = piece.codePointAt(0);
        const out = (pieceCode === undefined ? null : asciiDigit(pieceCode)) ?? piece;
        for (let k = 0; k < out.length; k += 1) {
          chars.push(out.charAt(k));
          starts.push(i);
          ends.push(i + width);
        }
      }
    }

    i += width;
  }

  return { text: chars.join(''), starts, ends };
}

/** Letters people substitute for digits ("l" for 1, "o" for 0, "s" for 5). */
const LOOKALIKE_DIGITS: Readonly<Record<string, string>> = {
  o: '0',
  l: '1',
  i: '1',
  z: '2',
  e: '3',
  a: '4',
  s: '5',
  t: '7',
  b: '8',
  g: '9',
  q: '9',
};

/** Same length and indexing as its input, with look-alike letters folded to digits. */
function foldLookalikes(text: string): string {
  let out = '';
  for (const ch of text) out += LOOKALIKE_DIGITS[ch] ?? ch;
  return out;
}

// ── Detectors ──────────────────────────────────────────────────

interface Range {
  start: number;
  end: number;
}

/** Plain email addresses — local@domain.tld. */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Obfuscated email addresses: "name at gmail dot com", "name(at)gmail(dot)com".
 * Two rules keep ordinary training talk out of this:
 *  - the trailing label is letters-only, so "3x8 at 82.5" cannot read as
 *    name-at-domain-dot-label;
 *  - a plain "." must sit tight against its label, so a full stop ending a
 *    sentence cannot glue the next word on ("3x5 @ 60kg. Week 2" is safe).
 */
const AT_PART = String.raw`(?:@|[([{]\s*at\s*[)\]}]|\bat\b)`;
const LABEL_PART = String.raw`[a-z]{2,24}`;
const DOTTED_LABEL = String.raw`(?:\.${LABEL_PART}|\s*(?:[([{]\s*(?:dot|d0t)\s*[)\]}]|\bdot\b)\s*${LABEL_PART})`;
const OBFUSCATED_EMAIL_RE = new RegExp(
  String.raw`[a-z0-9._%+-]{1,64}\s*${AT_PART}\s*[a-z0-9-]{1,63}(?:${DOTTED_LABEL})+`,
  'gi',
);

/**
 * Off-app platforms, including the ones whose links carry no "@" at all
 * (wa.me, t.me, discord.gg …). The bare brand name counts too — "hit me on
 * telegram" is the same hand-off as the link.
 */
const PLATFORM_RE = new RegExp(
  String.raw`\b(?:https?:\/\/)?(?:www\.)?(?:` +
    [
      String.raw`wa\.me`,
      String.raw`t\.me`,
      String.raw`m\.me`,
      String.raw`ig\.me`,
      String.raw`signal\.me`,
      String.raw`discord\.gg`,
      String.raw`linktr\.ee`,
      String.raw`telegram(?:\.me|\.org)?`,
      String.raw`instagram(?:\.com)?`,
      String.raw`snapchat(?:\.com)?`,
      String.raw`facebook(?:\.com)?`,
      String.raw`messenger(?:\.com)?`,
      String.raw`whatsapp(?:\.com)?`,
      String.raw`discord(?:app)?(?:\.com)?`,
      String.raw`tiktok(?:\.com)?`,
      String.raw`linkedin(?:\.com)?`,
      String.raw`twitter(?:\.com)?`,
    ].join('|') +
    String.raw`)(?:\/\S*)?`,
  'gi',
);

/**
 * Social handles ANYWHERE, not only after a space: "(@greece_lifts)" and
 * "here:@greece_lifts" hand over the same account. Any local part glued to the
 * front comes with it, so a half-address is never left standing.
 */
const HANDLE_RE = /[a-z0-9._%+-]*@[a-z0-9_]{2,}(?:\.[a-z0-9_]+)*/gi;

/** Digit words, longest alternative first so "niner" is not read as "nine". */
const SPELLED_DIGITS = [
  'zero',
  'nought',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'niner',
  'nine',
];
const SPELLED_TOKEN = String.raw`(?:${SPELLED_DIGITS.join('|')})\b|\d+`;
/** Two or more digit tokens in a row, where a token may be spelled or numeric. */
const SPELLED_RUN_RE = new RegExp(
  String.raw`\b(?:${SPELLED_TOKEN})(?:[\s\-.,]{1,2}(?:${SPELLED_TOKEN}))+`,
  'g',
);
const SPELLED_TOKEN_RE = new RegExp(SPELLED_TOKEN, 'g');

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Characters that may sit between two groups of a written phone number.
 * Deliberately excludes the comma (thousands separator) and the slash (dates),
 * so prices and dates never read as one long number.
 */
const GROUP_SEPARATORS = new Set([' ', '\t', '-', '.', '(', ')']);

function isGroupSeparator(ch: string): boolean {
  return GROUP_SEPARATORS.has(ch);
}

interface NumberRun extends Range {
  /** Digit count of each group, in order. */
  groups: number[];
}

/** Maximal runs of digit groups joined by phone-style separators. */
function numberRuns(text: string): NumberRun[] {
  const runs: NumberRun[] = [];
  let i = 0;

  while (i < text.length) {
    if (!isDigit(text.charAt(i))) {
      i += 1;
      continue;
    }

    let start = i;
    let end = i;
    const groups: number[] = [];

    for (;;) {
      let size = 0;
      while (end < text.length && isDigit(text.charAt(end))) {
        end += 1;
        size += 1;
      }
      groups.push(size);

      let probe = end;
      let separators = 0;
      let sawDot = false;
      while (probe < text.length && separators < 2 && isGroupSeparator(text.charAt(probe))) {
        if (text.charAt(probe) === '.') sawDot = true;
        probe += 1;
        separators += 1;
      }
      if (separators === 0 || probe >= text.length || !isDigit(text.charAt(probe))) break;

      // A dot only joins two groups when BOTH sides are 3+ digits, which is how
      // phone numbers get written (984.123.4567) and never how a weight (102.5)
      // or a price (1299.00) does.
      if (sawDot) {
        let nextSize = 0;
        let scan = probe;
        while (scan < text.length && isDigit(text.charAt(scan))) {
          scan += 1;
          nextSize += 1;
        }
        if ((groups[groups.length - 1] ?? 0) < 3 || nextSize < 3) break;
      }

      end = probe;
    }

    // A leading "+" or "(" belongs to the number, not to the sentence.
    while (start > 0 && (text.charAt(start - 1) === '+' || text.charAt(start - 1) === '(')) {
      start -= 1;
    }

    runs.push({ start, end, groups });
    i = end;
  }

  return runs;
}

/**
 * Does this run of digits look like a phone number a person would actually
 * write? Total length is necessary but nowhere near sufficient: a warm-up
 * ladder ("40 50 60 70 80 90 100") is 15 digits, and a date is 8. What
 * separates a phone number is its SHAPE — a few groups, at most one very short
 * one. The one exception is a number spaced out digit by digit, which no rep
 * scheme looks like at that length.
 */
function looksLikePhone(groups: number[]): boolean {
  const total = groups.reduce((sum, size) => sum + size, 0);
  if (total < 7 || total > 15) return false;

  const short = groups.filter((size) => size <= 2).length;
  if (groups.length <= 5 && short <= 1) return true;
  if (groups.length >= 8 && groups.every((size) => size === 1)) return true;

  return false;
}

/** Phone-shaped runs, read once as written and once with look-alike letters folded. */
function phoneRanges(plain: string, folded: string): Range[] {
  const found: Range[] = [];

  for (const run of numberRuns(plain)) {
    if (looksLikePhone(run.groups)) found.push({ start: run.start, end: run.end });
  }

  for (const run of numberRuns(folded)) {
    if (!looksLikePhone(run.groups)) continue;

    // Folding turns ordinary words into digits ("best set" reads as 8357 537),
    // so a folded run only counts when it is a real number wearing a light
    // disguise: every group anchored by at least one true digit, both ends
    // true digits, and no more than a couple of stand-ins overall.
    let substituted = 0;
    let realDigits = 0;
    let groupHasReal = false;
    let everyGroupAnchored = true;
    let inGroup = false;
    // The run may start on a "+" or "(", so find the first actual digit rather
    // than testing run.start.
    let firstDigit = -1;

    for (let i = run.start; i < run.end; i += 1) {
      if (!isDigit(folded.charAt(i))) {
        if (inGroup && !groupHasReal) everyGroupAnchored = false;
        inGroup = false;
        groupHasReal = false;
        continue;
      }
      if (firstDigit === -1) firstDigit = i;
      if (!inGroup) {
        inGroup = true;
        groupHasReal = false;
      }
      if (isDigit(plain.charAt(i))) {
        realDigits += 1;
        groupHasReal = true;
      } else {
        substituted += 1;
      }
    }
    if (inGroup && !groupHasReal) everyGroupAnchored = false;

    if (!everyGroupAnchored) continue;
    // Nothing folded means this is the same run the plain pass already saw.
    if (substituted === 0 || substituted > 2) continue;
    if (realDigits < 5) continue;
    // Both ends must be genuine digits, so a stand-in letter can never drag a
    // neighbouring word into the mask.
    if (firstDigit === -1 || !isDigit(plain.charAt(firstDigit))) continue;
    if (!isDigit(plain.charAt(run.end - 1))) continue;

    found.push({ start: run.start, end: run.end });
  }

  return found;
}

/**
 * Digits written as words. "nine eight four two" and "98 four two" are both
 * someone reading a number out loud; three spelled digits in a row is never an
 * accident. A single spelled digit next to a number is left alone, because
 * "did 100 five times" is ordinary gym talk.
 */
function spelledRanges(text: string): Range[] {
  const found: Range[] = [];
  SPELLED_RUN_RE.lastIndex = 0;

  for (;;) {
    const match = SPELLED_RUN_RE.exec(text);
    if (match === null) break;

    let spelled = 0;
    let digits = 0;
    SPELLED_TOKEN_RE.lastIndex = 0;
    for (;;) {
      const token = SPELLED_TOKEN_RE.exec(match[0]);
      if (token === null) break;
      if (/^\d+$/.test(token[0])) {
        digits += token[0].length;
      } else {
        spelled += 1;
        digits += 1;
      }
    }

    if (spelled >= 3 || (spelled >= 2 && digits >= 4)) {
      found.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return found;
}

function regexRanges(text: string, pattern: RegExp): Range[] {
  const found: Range[] = [];
  pattern.lastIndex = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) break;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** Sort, then fuse anything that overlaps or touches into one mask. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges]
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * Masks emails, phone numbers, off-app platform links and social handles in a
 * message body. Idempotent, and everything it does not hide keeps its exact
 * original text.
 */
export function maskPii(body: string): string {
  if (body.length === 0) return body;

  const normalised = normalise(body);
  const plain = normalised.text;
  if (plain.length === 0) return body;
  const folded = foldLookalikes(plain);

  // Every detector reads the same normalised copy and reports spans; anything
  // that overlaps or touches is fused into one mask below, so a phone number
  // sitting inside a link is hidden once, not twice.
  const detected: Range[] = [
    ...regexRanges(plain, EMAIL_RE),
    ...regexRanges(plain, OBFUSCATED_EMAIL_RE),
    ...regexRanges(plain, PLATFORM_RE),
    ...regexRanges(plain, HANDLE_RE),
    ...spelledRanges(plain),
    ...phoneRanges(plain, folded),
  ];
  if (detected.length === 0) return body;

  const inOriginal = detected.map((range) => ({
    start: normalised.starts[range.start] ?? 0,
    end: normalised.ends[range.end - 1] ?? 0,
  }));

  let out = '';
  let cursor = 0;
  for (const range of mergeRanges(inOriginal)) {
    if (range.start < cursor) continue;
    out += body.slice(cursor, range.start) + PII_MASK;
    cursor = range.end;
  }
  return out + body.slice(cursor);
}

/** True when masking changed the body — callers can tell the sender. */
export function containsPii(body: string): boolean {
  return maskPii(body) !== body;
}
