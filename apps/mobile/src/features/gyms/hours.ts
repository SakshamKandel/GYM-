import { GYM_DAY_KEYS, isOpenNow, type GymWeeklyHours } from '@gym/shared';

/**
 * Presentation helpers for a gym's weekly hours — builds on the pure
 * `isOpenNow` in @gym/shared (which owns the KTM wall-clock + overnight-shift
 * logic and is unit-tested there). This file only formats: a friendly 12-hour
 * clock, and a human open/closed line that names the NEXT opening when a gym
 * is shut ("Closed · opens 6 AM", "…opens 6 AM tomorrow", "…opens Mon 6 AM").
 *
 * Hours are KTM wall-clock (Nepal, fixed UTC+05:45, no DST) — the same frame
 * `isOpenNow` uses, so "now" here is derived identically.
 */

const KTM_OFFSET_MS = 345 * 60_000;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((p) => Number(p));
  return h * 60 + m;
}

/** "06:00" → "6 AM", "22:30" → "10:30 PM", "00:00" → "12 AM". */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((p) => Number(p));
  if (Number.isNaN(h)) return hhmm;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Format one shift for the hours table, e.g. "6 AM – 10 PM". */
export function formatShift(open: string, close: string): string {
  return `${to12h(open)} – ${to12h(close)}`;
}

export interface OpenState {
  open: boolean;
  /** One-line status suitable for a pill/caption. */
  label: string;
}

/**
 * Resolve the current open/closed state into a display line. When open, names
 * the closing time; when closed, scans forward up to a week for the next shift
 * and names when it opens. Falls back to a bare "Open now"/"Closed" when no
 * time is available.
 */
export function describeOpenState(hours: GymWeeklyHours, now: Date): OpenState {
  const status = isOpenNow(hours, now);
  if (status.open) {
    return {
      open: true,
      label: status.closesAt ? `Open now · closes ${to12h(status.closesAt)}` : 'Open now',
    };
  }

  const shifted = new Date(now.getTime() + KTM_OFFSET_MS);
  const dayIdx = shifted.getUTCDay();
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();

  for (let ahead = 0; ahead < 8; ahead += 1) {
    const idx = (dayIdx + ahead) % 7;
    const shifts = [...(hours[GYM_DAY_KEYS[idx]] ?? [])].sort(
      (a, b) => toMinutes(a.open) - toMinutes(b.open),
    );
    for (const shift of shifts) {
      // Today: only a shift that opens later counts as "next" (we're already
      // closed, so anything earlier has passed or was an overnight edge case).
      if (ahead === 0 && toMinutes(shift.open) <= minutes) continue;
      const when = ahead === 0 ? '' : ahead === 1 ? ' tomorrow' : ` ${DAY_SHORT[idx]}`;
      return { open: false, label: `Closed · opens ${to12h(shift.open)}${when}` };
    }
  }

  return { open: false, label: 'Closed' };
}
