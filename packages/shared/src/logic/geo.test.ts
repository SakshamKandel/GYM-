import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerHooks } from 'node:module';

// geo.ts imports its sibling helper (./gyms) without an extension — the
// repo-wide source idiom, and required because the app tsconfigs do not enable
// allowImportingTsExtensions. Node's type stripping needs explicit extensions at
// runtime, so bridge relative specifiers to their .ts files for this test process
// only (node --test isolates each file in its own process; see progression.test.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (typeof specifier === 'string' && specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const { latLngSchema, latSchema, lngSchema, withinRadiusKm } = await import('./geo.ts');

// Kathmandu reference point.
const KTM = { lat: 27.7172, lng: 85.324 };

describe('withinRadiusKm', () => {
  it('the center itself is within any positive radius', () => {
    assert.equal(withinRadiusKm(KTM, 5, KTM), true);
  });

  it('a point ~1.11 km north is inside a 2 km radius', () => {
    // 0.01° latitude ≈ 1.11 km.
    assert.equal(withinRadiusKm(KTM, 2, { lat: KTM.lat + 0.01, lng: KTM.lng }), true);
  });

  it('a point ~1.11 km north is outside a 1 km radius', () => {
    assert.equal(withinRadiusKm(KTM, 1, { lat: KTM.lat + 0.01, lng: KTM.lng }), false);
  });

  it('is inclusive of the boundary', () => {
    const p = { lat: KTM.lat + 0.01, lng: KTM.lng };
    const d = 1.1119; // ~distance to p
    // radius just above the exact distance always includes it.
    assert.equal(withinRadiusKm(KTM, d + 0.001, p), true);
  });

  it('a zero radius never matches (not even the center)', () => {
    assert.equal(withinRadiusKm(KTM, 0, KTM), false);
  });

  it('a negative radius never matches', () => {
    assert.equal(withinRadiusKm(KTM, -5, KTM), false);
  });

  it('a non-finite radius never matches', () => {
    assert.equal(withinRadiusKm(KTM, Number.NaN, KTM), false);
    assert.equal(withinRadiusKm(KTM, Number.POSITIVE_INFINITY, KTM), false);
  });

  it('a far-away point is outside a small radius', () => {
    // Pokhara is ~140 km from Kathmandu.
    assert.equal(withinRadiusKm(KTM, 50, { lat: 28.2096, lng: 83.9856 }), false);
  });
});

describe('lat/lng zod schemas', () => {
  it('accepts in-range coordinates', () => {
    assert.equal(latSchema.safeParse(27.7).success, true);
    assert.equal(lngSchema.safeParse(85.3).success, true);
    assert.equal(latSchema.safeParse(-90).success, true);
    assert.equal(latSchema.safeParse(90).success, true);
    assert.equal(lngSchema.safeParse(-180).success, true);
    assert.equal(lngSchema.safeParse(180).success, true);
  });

  it('rejects out-of-range coordinates', () => {
    assert.equal(latSchema.safeParse(90.1).success, false);
    assert.equal(latSchema.safeParse(-90.1).success, false);
    assert.equal(lngSchema.safeParse(180.1).success, false);
    assert.equal(lngSchema.safeParse(-180.1).success, false);
  });

  it('rejects non-finite values', () => {
    assert.equal(latSchema.safeParse(Number.NaN).success, false);
    assert.equal(lngSchema.safeParse(Number.POSITIVE_INFINITY).success, false);
  });

  it('latLngSchema validates a full point', () => {
    assert.equal(latLngSchema.safeParse(KTM).success, true);
    assert.equal(latLngSchema.safeParse({ lat: 200, lng: 0 }).success, false);
    assert.equal(latLngSchema.safeParse({ lat: 0 }).success, false);
  });
});
