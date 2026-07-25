import type {
  GymAmenity,
  GymCategory,
  GymCrowdStatus,
  GymEquipmentItem,
  GymPassOption,
  GymStatus,
  GymWeeklyHours,
} from '@gym/shared';

export interface GymSocialLinkValue {
  platform: string;
  url: string;
}

export interface GymPhotoRow {
  id: string;
  deliveryUrl: string;
  sortOrder: number;
}

/** One row of the admin gym roster — mirrors GET /api/admin/gyms + a joined,
 * sortOrder-ordered photo list (the admin page loads photos server-side so
 * the edit modal never needs an extra round-trip). */
export interface GymRow {
  id: string;
  slug: string;
  name: string;
  category: GymCategory;
  addressText: string;
  city: string;
  district: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  website: string | null;
  socialLinks: GymSocialLinkValue[];
  hours: GymWeeklyHours;
  amenities: GymAmenity[];
  /** Operator-supplied kit list. Empty = we were never told; never invented. */
  equipment: GymEquipmentItem[];
  /** null = no busy-times info for this gym (the honest default). */
  crowdData: GymCrowdStatus | null;
  /** Day passes / memberships. Empty = the gym has not given us any. */
  passOptions: GymPassOption[];
  externalImageUrl: string | null;
  priceNote: string;
  description: string;
  rating: number | null;
  reviewCount: number | null;
  status: GymStatus;
  verifiedByAdmin: boolean;
  photos: GymPhotoRow[];
}
