import { distanceKm } from '@gym/shared/src/logic/gyms.ts';

/** Partner delivery coverage as stored on `meal_partners`. */
export interface PartnerDeliveryCoverage {
  serviceAreas: readonly string[];
  serviceLat: number | null;
  serviceLng: number | null;
  serviceRadiusKm: number | null;
}

/** Saved-address fields that can establish delivery eligibility. */
export interface AddressDeliveryCoverage {
  area: string;
  lat: number | null;
  lng: number | null;
}

export type DeliveryEligibility = 'eligible' | 'outside' | 'unverified';
export type DeliveryEligibilityError = 'outside_delivery_area' | 'delivery_area_unverified';

// Partner administration bounds service radii to 0..200 km. A zero radius means
// geo coverage is disabled, so only a configured text service area can qualify.
const MAX_SERVICE_RADIUS_KM = 200;

function validPoint(lat: number | null, lng: number | null) {
  if (
    lat === null ||
    lng === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function validRadius(radiusKm: number | null): radiusKm is number {
  return (
    radiusKm !== null &&
    Number.isFinite(radiusKm) &&
    radiusKm > 0 &&
    radiusKm <= MAX_SERVICE_RADIUS_KM
  );
}

function normalizedArea(value: string): string {
  return value.trim().toLowerCase();
}

function areaMatches(partnerAreas: readonly string[], addressArea: string): boolean | null {
  const needle = normalizedArea(addressArea);
  const areas = partnerAreas.map(normalizedArea).filter((area) => area.length > 0);
  if (!needle || areas.length === 0) return null;
  return areas.some((area) => area.includes(needle) || needle.includes(area));
}

/**
 * Resolve whether a saved address is deliverable by a partner.
 *
 * A complete, bounded geo configuration is authoritative when both sides have
 * valid coordinates. Otherwise the partner's configured text service areas are
 * used as a deterministic fallback. Missing/partial/invalid geo without a usable
 * text match is deliberately `unverified`; payable resources must never be
 * created by guessing that an address is covered.
 */
export function deliveryEligibility(
  partner: PartnerDeliveryCoverage,
  address: AddressDeliveryCoverage | null,
): DeliveryEligibility {
  if (!address) return 'unverified';

  const center = validPoint(partner.serviceLat, partner.serviceLng);
  const point = validPoint(address.lat, address.lng);
  if (center && point && validRadius(partner.serviceRadiusKm)) {
    return distanceKm(center, point) <= partner.serviceRadiusKm ? 'eligible' : 'outside';
  }

  const textMatch = areaMatches(partner.serviceAreas, address.area);
  if (textMatch === null) return 'unverified';
  return textMatch ? 'eligible' : 'outside';
}

/**
 * Stable member-facing API code for a non-eligible result.
 *
 * `unverified` does NOT block ordering. Both sides of the check have
 * optional data — a member's saved address only requires `line` + `phone`
 * (area/map pin are explicitly optional in AddressSheet), and a newly
 * onboarded partner starts with no `serviceAreas`/geo radius configured — so
 * hard-rejecting `unverified` here 400'd real, legitimate orders for members
 * and partners who simply hadn't filled in that optional metadata (reported
 * as "delivery address issue, must be server-side" — it was). We can only
 * confidently reject `outside` (both sides had enough data to say no); an
 * unverifiable address still reaches the partner, who can decline a specific
 * order in the partner portal if it's genuinely out of range.
 */
export function deliveryEligibilityError(
  eligibility: DeliveryEligibility,
): DeliveryEligibilityError | null {
  if (eligibility === 'outside') return 'outside_delivery_area';
  return null;
}
