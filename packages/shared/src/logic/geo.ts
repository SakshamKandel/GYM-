/**
 * Geo foundation — coordinate validation + radius membership. Pure logic, no I/O
 * (CLAUDE.md rule 10). Builds on the existing haversine `distanceKm` in gyms.ts;
 * the zod schemas here are the single source of truth for lat/lng bounds crossing
 * the network boundary (rule 8), used by the geo-search proxy and any payload
 * that carries a coordinate.
 */
import { z } from 'zod';
import { distanceKm } from './gyms';

/** A geographic point. Longitude uses the ±180 convention. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Latitude in decimal degrees, WGS-84 valid range [-90, 90]. */
export const latSchema = z
  .number()
  .finite()
  .min(-90, 'lat must be ≥ -90')
  .max(90, 'lat must be ≤ 90');

/** Longitude in decimal degrees, WGS-84 valid range [-180, 180]. */
export const lngSchema = z
  .number()
  .finite()
  .min(-180, 'lng must be ≥ -180')
  .max(180, 'lng must be ≤ 180');

/** A validated { lat, lng } point. */
export const latLngSchema = z.object({ lat: latSchema, lng: lngSchema });

export type LatLngInput = z.infer<typeof latLngSchema>;

/**
 * Is `point` within `radiusKm` great-circle kilometres of `center`? Inclusive of
 * the boundary (distance == radius counts as inside). A non-positive or
 * non-finite radius is treated as "no reach" and always returns false, so a
 * partner with a null/0 delivery radius never matches by distance.
 */
export function withinRadiusKm(center: LatLng, radiusKm: number, point: LatLng): boolean {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  return distanceKm(center, point) <= radiusKm;
}
