import { withinRadiusKm } from '@gym/shared';
import { colors } from '@gym/ui-tokens';
import { Tag } from '../../../components/ui';
import type { MealPartner } from '../api';

/**
 * "Delivers to you" / "Outside delivery area" — a client-side courtesy signal
 * only (plan item: maps-mobile build 2). The server stays the sole authority
 * on whether an order is actually accepted; this never blocks anything, it
 * just sets expectations before checkout. Two independent signals, geo takes
 * priority when both partner and address have coordinates:
 *
 *  1. Geo: partner.serviceLat/Lng/serviceRadiusKm + the address point, via
 *     the shared haversine `withinRadiusKm` (same helper the server uses).
 *  2. Text: the address's free-text `area` against the partner's
 *     `serviceAreas` list (case-insensitive substring match either way).
 *
 * Returns 'unknown' — render nothing — when neither signal has enough data
 * to say anything, rather than guessing.
 */

export type DeliveryStatus = 'in' | 'out' | 'unknown';

export interface DeliveryPoint {
  lat: number | null;
  lng: number | null;
}

function areaMatches(partnerAreas: string[], addressArea: string): boolean {
  const needle = addressArea.trim().toLowerCase();
  if (!needle) return false;
  return partnerAreas.some((a) => {
    const hay = a.trim().toLowerCase();
    return hay.length > 0 && (hay.includes(needle) || needle.includes(hay));
  });
}

export function deliveryStatus(
  partner: Pick<MealPartner, 'serviceAreas' | 'serviceLat' | 'serviceLng' | 'serviceRadiusKm'>,
  point: DeliveryPoint | null,
  addressArea: string,
): DeliveryStatus {
  const pointLat = point?.lat ?? null;
  const pointLng = point?.lng ?? null;
  const { serviceLat, serviceLng, serviceRadiusKm } = partner;

  if (pointLat !== null && pointLng !== null && serviceLat != null && serviceLng != null && serviceRadiusKm != null) {
    const inRange = withinRadiusKm(
      { lat: serviceLat, lng: serviceLng },
      serviceRadiusKm,
      { lat: pointLat, lng: pointLng },
    );
    return inRange ? 'in' : 'out';
  }

  if (partner.serviceAreas.length > 0 && addressArea.trim()) {
    return areaMatches(partner.serviceAreas, addressArea) ? 'in' : 'out';
  }

  return 'unknown';
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  if (status === 'in') return <Tag label="Delivers to you" variant="dim" color={colors.success} />;
  if (status === 'out') return <Tag label="Outside delivery area" variant="dim" color={colors.warning} />;
  return null;
}
