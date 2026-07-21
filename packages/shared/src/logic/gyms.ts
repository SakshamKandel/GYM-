/**
 * Nearby-gyms pure logic — open-now resolution from structured weekly hours and
 * great-circle distance. No I/O (CLAUDE.md rule 10; plan §4/§8). Hours are KTM
 * wall-clock (Nepal, fixed UTC+05:45, no DST).
 */

export type GymCategory = 'gym' | 'health_club' | 'studio' | 'crossfit' | 'yoga' | 'other';
export type GymStatus = 'draft' | 'published' | 'archived';

export const GYM_CATEGORIES: readonly GymCategory[] = [
  'gym',
  'health_club',
  'studio',
  'crossfit',
  'yoga',
  'other',
];

/** Selectable amenity keys (drives the admin multi-select + mobile chips). */
export const GYM_AMENITIES = [
  'pool',
  'sauna',
  'steam',
  'cardio_zone',
  'free_weights',
  'group_classes',
  'personal_training',
  'parking',
  'locker_rooms',
  'showers',
  'wifi',
  'ac',
  'turf',
  'power_racks',
  'recovery',
  '24_7_access',
] as const;

export type GymAmenity = (typeof GYM_AMENITIES)[number];

export type GymEquipmentCategory = 'free_weights' | 'cardio' | 'machines' | 'functional' | 'recovery';

export interface GymEquipmentItem {
  id: string;
  name: string;
  category: GymEquipmentCategory;
  count?: number;
  description?: string;
}

export type GymCrowdLevel = 'quiet' | 'moderate' | 'busy' | 'packed';

export interface GymCrowdStatus {
  level: GymCrowdLevel;
  percentage: number; // 0 - 100
  hourlyOccupancy?: number[]; // 24 values representing occupancy % throughout the day
  peakHoursText?: string;
}

export type GymPassType = 'day_pass' | 'weekly_pass' | 'monthly' | 'annual';

export interface GymPassOption {
  id: string;
  type: GymPassType;
  title: string;
  priceMinor: number;
  currency: 'NPR' | 'USD';
  features: string[];
  isPopular?: boolean;
}


/** Weekday keys, index 0=Sunday … 6=Saturday (matches Date.getUTCDay). */
export const GYM_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type GymDayKey = (typeof GYM_DAY_KEYS)[number];

/** One open→close shift (HH:MM 24h, KTM local). */
export interface GymHoursShift {
  open: string;
  close: string;
}

/** Structured weekly hours — per-day shift list. A missing/empty day = closed. */
export type GymWeeklyHours = Partial<Record<GymDayKey, GymHoursShift[]>>;

const KTM_OFFSET_MS = 345 * 60_000;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((p) => Number(p));
  return h * 60 + m;
}

/** KTM wall-clock day index (0=Sun) and minutes-since-midnight for an instant. */
function ktmWallParts(now: Date): { dayIdx: number; minutes: number } {
  const shifted = new Date(now.getTime() + KTM_OFFSET_MS);
  return {
    dayIdx: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * Is the gym open at `now` (KTM)? Handles multi-shift days and overnight shifts
 * (close ≤ open ⇒ the shift crosses midnight into the next day). Returns the
 * current shift's close time when open.
 */
export function isOpenNow(
  hours: GymWeeklyHours,
  now: Date,
): { open: boolean; closesAt?: string } {
  const { dayIdx, minutes } = ktmWallParts(now);

  // Shifts starting today.
  const todayKey = GYM_DAY_KEYS[dayIdx];
  for (const shift of hours[todayKey] ?? []) {
    const openM = toMinutes(shift.open);
    const closeM = toMinutes(shift.close);
    if (closeM === openM) continue; // zero-length / invalid
    if (closeM > openM) {
      if (minutes >= openM && minutes < closeM) return { open: true, closesAt: shift.close };
    } else if (minutes >= openM) {
      // Overnight shift — open from openM through midnight.
      return { open: true, closesAt: shift.close };
    }
  }

  // Overnight shift that STARTED yesterday and spills into today's early hours.
  const prevKey = GYM_DAY_KEYS[(dayIdx + 6) % 7];
  for (const shift of hours[prevKey] ?? []) {
    const openM = toMinutes(shift.open);
    const closeM = toMinutes(shift.close);
    if (closeM === openM) continue;
    if (closeM < openM && minutes < closeM) return { open: true, closesAt: shift.close };
  }

  return { open: false };
}

/**
 * Great-circle distance in kilometres between two lat/lng points (haversine,
 * mean Earth radius 6371 km). Used to sort/label nearby gyms by distance.
 */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
