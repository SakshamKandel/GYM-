import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  distanceKm,
  gymCrowdStatusSchema,
  gymPassOptionSchema,
  gymPublicCardSchema,
  gymPublicDetailResponseSchema,
  isOpenNow,
  type GymWeeklyHours,
} from './gyms.ts';

function ktm(y: number, mo: number, da: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, mo - 1, da, hh, mm) - 345 * 60_000);
}

describe('isOpenNow — single daytime shift', () => {
  // 2026-07-18 is a Saturday (key 'sat').
  const hours: GymWeeklyHours = { sat: [{ open: '06:00', close: '22:00' }] };
  it('open inside the shift, reporting the close time', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 10, 0)), { open: true, closesAt: '22:00' });
  });
  it('closed before opening', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 5, 0)), { open: false });
  });
  it('closed at the close minute (half-open interval)', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 22, 0)), { open: false });
  });
  it('closed on a day with no shifts', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 19, 10, 0)), { open: false }); // Sunday
  });
});

describe('isOpenNow — multi-shift day', () => {
  const hours: GymWeeklyHours = {
    sat: [
      { open: '06:00', close: '10:00' },
      { open: '16:00', close: '21:00' },
    ],
  };
  it('open in the morning shift', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 8, 0)), { open: true, closesAt: '10:00' });
  });
  it('closed between shifts', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 12, 0)), { open: false });
  });
  it('open in the evening shift', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 17, 0)), { open: true, closesAt: '21:00' });
  });
});

describe('isOpenNow — overnight shift', () => {
  // Friday 20:00 → 02:00 (crosses midnight into Saturday). 2026-07-17 is Friday.
  const hours: GymWeeklyHours = { fri: [{ open: '20:00', close: '02:00' }] };
  it('open late on the starting day', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 17, 23, 0)), { open: true, closesAt: '02:00' });
  });
  it('open in the early hours of the NEXT day (spill)', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 1, 0)), { open: true, closesAt: '02:00' });
  });
  it('closed after the overnight close', () => {
    assert.deepEqual(isOpenNow(hours, ktm(2026, 7, 18, 2, 30)), { open: false });
  });
});

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    assert.equal(distanceKm({ lat: 27.7172, lng: 85.324 }, { lat: 27.7172, lng: 85.324 }), 0);
  });
  it('≈111.19 km for one degree of latitude', () => {
    const d = distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(d - 111.19) < 0.5, `got ${d}`);
  });
  it('is symmetric', () => {
    const a = { lat: 27.7, lng: 85.3 };
    const b = { lat: 27.71, lng: 85.33 };
    assert.ok(Math.abs(distanceKm(a, b) - distanceKm(b, a)) < 1e-9);
  });
});

describe('public gym authenticity schemas', () => {
  const baseCard = {
    id: 'gym-1',
    slug: 'real-gym',
    name: 'Real Gym',
    category: 'gym' as const,
    city: 'Lalitpur',
    lat: null,
    lng: null,
    rating: null,
    reviewCount: null,
    photos: [],
    distanceKm: null,
  };

  it('keeps unavailable list enrichment absent instead of manufacturing values', () => {
    const parsed = gymPublicCardSchema.parse(baseCard);
    assert.equal('crowdData' in parsed, false);
    assert.equal('equipment' in parsed, false);
    assert.equal('dayPassPriceMinor' in parsed, false);
    assert.equal(parsed.lat, null);
    assert.equal(parsed.lng, null);
  });

  it('accepts and preserves a complete backend crowd profile', () => {
    const crowdData = {
      level: 'busy' as const,
      percentage: 72,
      hourlyOccupancy: Array.from({ length: 24 }, (_, hour) => hour * 3),
      peakHoursText: 'Reported busiest from 5 PM to 7 PM',
    };
    const parsed = gymPublicCardSchema.parse({ ...baseCard, crowdData });
    assert.deepEqual(parsed.crowdData, crowdData);
  });

  it('rejects invented-looking defaults and malformed crowd profiles', () => {
    assert.equal(gymCrowdStatusSchema.safeParse({ level: 'moderate', percentage: 101 }).success, false);
    assert.equal(
      gymCrowdStatusSchema.safeParse({
        level: 'quiet',
        percentage: 20,
        hourlyOccupancy: Array.from({ length: 23 }, () => 20),
      }).success,
      false,
    );
    assert.equal(gymCrowdStatusSchema.safeParse({ percentage: 45 }).success, false);
  });

  it('requires backend pass prices, currency, and features to be valid', () => {
    const pass = {
      id: 'day-1',
      type: 'day_pass' as const,
      title: 'Day pass',
      priceMinor: 75_000,
      currency: 'NPR' as const,
      features: ['Gym floor access'],
    };
    assert.deepEqual(gymPassOptionSchema.parse(pass), pass);
    assert.equal(gymPassOptionSchema.safeParse({ ...pass, priceMinor: -1 }).success, false);
    assert.equal(gymPassOptionSchema.safeParse({ ...pass, currency: 'EUR' }).success, false);
  });

  it('represents missing detail enrichment with empty arrays and nullable coordinates', () => {
    const response = gymPublicDetailResponseSchema.parse({
      gym: {
        id: baseCard.id,
        slug: baseCard.slug,
        name: baseCard.name,
        category: baseCard.category,
        city: baseCard.city,
        lat: baseCard.lat,
        lng: baseCard.lng,
        rating: baseCard.rating,
        reviewCount: baseCard.reviewCount,
        addressText: '',
        district: '',
        phone: '',
        website: null,
        socialLinks: [],
        hours: {},
        amenities: [],
        equipment: [],
        passOptions: [],
        coachIds: [],
        externalImageUrl: null,
        priceNote: '',
        description: '',
        photos: [{ id: 'photo-1', deliveryUrl: 'https://images.example.com/gym.jpg' }],
        isFavorited: false,
      },
    });

    assert.deepEqual(response.gym.equipment, []);
    assert.deepEqual(response.gym.passOptions, []);
    assert.equal(response.gym.photos[0]?.id, 'photo-1');
    assert.equal(response.gym.crowdData, undefined);
    assert.equal(response.gym.lat, null);
    assert.equal(response.gym.lng, null);
  });
});
