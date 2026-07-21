import type { Ionicons } from '@expo/vector-icons';

/**
 * Amenity → Ionicons glyph map, shared by the detail amenity grid (and any
 * future amenity chips). Keys are the `GYM_AMENITIES` union from @gym/shared;
 * anything unmapped falls back to a neutral ellipse so a new server-side
 * amenity never renders a blank chip.
 */
export const AMENITY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  pool: 'water',
  sauna: 'flame',
  steam: 'cloud',
  cardio_zone: 'heart',
  free_weights: 'barbell',
  group_classes: 'people',
  personal_training: 'person',
  parking: 'car',
  locker_rooms: 'lock-closed',
  showers: 'water-outline',
  wifi: 'wifi',
  ac: 'snow',
  turf: 'fitness',
  power_racks: 'hardware-chip',
  recovery: 'sparkles',
  '24_7_access': 'time',
};

export function amenityIcon(a: string): keyof typeof Ionicons.glyphMap {
  return AMENITY_ICON[a] ?? 'ellipse';
}

export function amenityLabel(a: string): string {
  return a.replace(/_/g, ' ');
}
