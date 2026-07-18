import type { GymAmenity, GymCategory, GymStatus, GymWeeklyHours } from '@gym/shared';

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
  externalImageUrl: string | null;
  priceNote: string;
  description: string;
  rating: number | null;
  reviewCount: number | null;
  status: GymStatus;
  verifiedByAdmin: boolean;
  photos: GymPhotoRow[];
}
