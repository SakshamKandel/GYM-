import { z } from 'zod';

/**
 * Nearby-gyms pure logic — open-now resolution from structured weekly hours and
 * great-circle distance. No I/O (CLAUDE.md rule 10; plan §4/§8). Hours are KTM
 * wall-clock (Nepal, fixed UTC+05:45, no DST).
 */

export const GYM_CATEGORIES = [
  'gym',
  'health_club',
  'studio',
  'crossfit',
  'yoga',
  'other',
] as const;

export const gymCategorySchema = z.enum(GYM_CATEGORIES);
export type GymCategory = z.infer<typeof gymCategorySchema>;

export const GYM_STATUSES = ['draft', 'published', 'archived'] as const;
export const gymStatusSchema = z.enum(GYM_STATUSES);
export type GymStatus = z.infer<typeof gymStatusSchema>;

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

export const gymAmenitySchema = z.enum(GYM_AMENITIES);

export const GYM_EQUIPMENT_CATEGORIES = [
  'free_weights',
  'cardio',
  'machines',
  'functional',
  'recovery',
] as const;

export const gymEquipmentCategorySchema = z.enum(GYM_EQUIPMENT_CATEGORIES);
export type GymEquipmentCategory = z.infer<typeof gymEquipmentCategorySchema>;

export const gymEquipmentItemSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(200),
    category: gymEquipmentCategorySchema,
    count: z.number().int().positive().max(10_000).optional(),
    description: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type GymEquipmentItem = z.infer<typeof gymEquipmentItemSchema>;

export const GYM_CROWD_LEVELS = ['quiet', 'moderate', 'busy', 'packed'] as const;
export const gymCrowdLevelSchema = z.enum(GYM_CROWD_LEVELS);
export type GymCrowdLevel = z.infer<typeof gymCrowdLevelSchema>;

export const gymCrowdStatusSchema = z
  .object({
    level: gymCrowdLevelSchema,
    percentage: z.number().min(0).max(100),
    hourlyOccupancy: z.array(z.number().min(0).max(100)).length(24).optional(),
    peakHoursText: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type GymCrowdStatus = z.infer<typeof gymCrowdStatusSchema>;

export const GYM_PASS_TYPES = ['day_pass', 'weekly_pass', 'monthly', 'annual'] as const;
export const gymPassTypeSchema = z.enum(GYM_PASS_TYPES);
export type GymPassType = z.infer<typeof gymPassTypeSchema>;

export const gymPassOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    type: gymPassTypeSchema,
    title: z.string().trim().min(1).max(200),
    priceMinor: z.number().int().nonnegative(),
    currency: z.enum(['NPR', 'USD']),
    features: z.array(z.string().trim().min(1).max(200)).max(20),
    isPopular: z.boolean().optional(),
  })
  .strict();
export type GymPassOption = z.infer<typeof gymPassOptionSchema>;


/** Weekday keys, index 0=Sunday … 6=Saturday (matches Date.getUTCDay). */
export const GYM_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type GymDayKey = (typeof GYM_DAY_KEYS)[number];

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One open→close shift (HH:MM 24h, KTM local). */
export const gymHoursShiftSchema = z
  .object({
    open: z.string().regex(HH_MM_PATTERN),
    close: z.string().regex(HH_MM_PATTERN),
  })
  .strict();
export type GymHoursShift = z.infer<typeof gymHoursShiftSchema>;

/** Structured weekly hours — per-day shift list. A missing/empty day = closed. */
export const gymWeeklyHoursSchema = z
  .object({
    sun: z.array(gymHoursShiftSchema).max(6).optional(),
    mon: z.array(gymHoursShiftSchema).max(6).optional(),
    tue: z.array(gymHoursShiftSchema).max(6).optional(),
    wed: z.array(gymHoursShiftSchema).max(6).optional(),
    thu: z.array(gymHoursShiftSchema).max(6).optional(),
    fri: z.array(gymHoursShiftSchema).max(6).optional(),
    sat: z.array(gymHoursShiftSchema).max(6).optional(),
  })
  .strict();
export type GymWeeklyHours = z.infer<typeof gymWeeklyHoursSchema>;

export const gymSocialLinkSchema = z
  .object({
    platform: z.string().trim().min(1).max(40),
    url: z.string().trim().url().max(500),
  })
  .strict();
export type GymSocialLink = z.infer<typeof gymSocialLinkSchema>;

export const gymPublicPhotoSchema = z
  .object({ deliveryUrl: z.string().trim().url().max(2_000) })
  .strict();

/** Public list card. Optional enrichment exists only when the DB supplied it. */
export const gymPublicCardSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    category: gymCategorySchema,
    city: z.string(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    rating: z.number().min(0).max(5).nullable(),
    reviewCount: z.number().int().nonnegative().nullable(),
    photos: z.array(gymPublicPhotoSchema),
    distanceKm: z.number().nonnegative().nullable(),
    crowdData: gymCrowdStatusSchema.optional(),
  })
  .strict();
export type GymPublicCard = z.infer<typeof gymPublicCardSchema>;

export const gymPublicListResponseSchema = z
  .object({
    gyms: z.array(gymPublicCardSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

/** Public detail. Empty arrays mean the operator has not supplied that data. */
export const gymPublicDetailSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    category: gymCategorySchema,
    addressText: z.string(),
    city: z.string(),
    district: z.string(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    phone: z.string(),
    website: z.string().trim().url().max(500).nullable(),
    socialLinks: z.array(gymSocialLinkSchema),
    hours: gymWeeklyHoursSchema,
    amenities: z.array(gymAmenitySchema),
    equipment: z.array(gymEquipmentItemSchema),
    crowdData: gymCrowdStatusSchema.optional(),
    passOptions: z.array(gymPassOptionSchema),
    coachIds: z.array(z.string().min(1)),
    externalImageUrl: z.string().trim().url().max(2_000).nullable(),
    priceNote: z.string(),
    description: z.string(),
    rating: z.number().min(0).max(5).nullable(),
    reviewCount: z.number().int().nonnegative().nullable(),
    photos: z.array(gymPublicPhotoSchema.extend({ id: z.string().min(1) })),
    isFavorited: z.boolean(),
  })
  .strict();
export type GymPublicDetail = z.infer<typeof gymPublicDetailSchema>;

export const gymPublicDetailResponseSchema = z
  .object({ gym: gymPublicDetailSchema })
  .strict();

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
