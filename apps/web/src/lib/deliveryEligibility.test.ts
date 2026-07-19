import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deliveryEligibility,
  deliveryEligibilityError,
  type AddressDeliveryCoverage,
  type PartnerDeliveryCoverage,
} from './deliveryEligibility.ts';

const partner: PartnerDeliveryCoverage = {
  serviceAreas: ['Baluwatar', 'Kathmandu 44600'],
  serviceLat: 27.7172,
  serviceLng: 85.324,
  serviceRadiusKm: 5,
};

const address: AddressDeliveryCoverage = {
  area: 'Baluwatar, Kathmandu',
  lat: 27.72,
  lng: 85.325,
};

describe('deliveryEligibility', () => {
  it('accepts a bounded address inside a valid geo radius', () => {
    assert.equal(deliveryEligibility(partner, address), 'eligible');
  });

  it('lets valid geo coverage override a matching text area', () => {
    assert.equal(
      deliveryEligibility(partner, { ...address, lat: 28.3, lng: 84.0 }),
      'outside',
    );
  });

  it('falls back to a case-insensitive text-area match when geo is incomplete', () => {
    assert.equal(
      deliveryEligibility(
        { ...partner, serviceLat: null, serviceLng: null, serviceRadiusKm: null },
        { ...address, area: '  BALUWATAR, KATHMANDU  ', lat: null, lng: null },
      ),
      'eligible',
    );
  });

  it('treats a usable text-area mismatch as outside coverage', () => {
    assert.equal(
      deliveryEligibility(
        { ...partner, serviceLat: null, serviceLng: null, serviceRadiusKm: null },
        { ...address, area: 'Pokhara', lat: null, lng: null },
      ),
      'outside',
    );
  });

  it('rejects out-of-bounds coordinates instead of using them for distance', () => {
    assert.equal(
      deliveryEligibility(
        { ...partner, serviceAreas: [] },
        { ...address, area: '', lat: 91, lng: 181 },
      ),
      'unverified',
    );
  });

  it('rejects zero or over-limit radii when no text fallback can verify coverage', () => {
    assert.equal(
      deliveryEligibility(
        { ...partner, serviceAreas: [], serviceRadiusKm: 0 },
        { ...address, area: '' },
      ),
      'unverified',
    );
    assert.equal(
      deliveryEligibility(
        { ...partner, serviceAreas: [], serviceRadiusKm: 201 },
        { ...address, area: '' },
      ),
      'unverified',
    );
  });

  it('rejects a missing address as unverified', () => {
    assert.equal(deliveryEligibility(partner, null), 'unverified');
  });
});

describe('deliveryEligibilityError', () => {
  it('maps non-eligible states to stable API codes', () => {
    assert.equal(deliveryEligibilityError('eligible'), null);
    assert.equal(deliveryEligibilityError('outside'), 'outside_delivery_area');
    assert.equal(deliveryEligibilityError('unverified'), 'delivery_area_unverified');
  });
});
