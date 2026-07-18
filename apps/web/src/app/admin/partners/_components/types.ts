/** One meal-partner roster row, as served by the admin partners page/API. */
export interface PartnerRow {
  id: string;
  accountId: string;
  name: string;
  contact: string;
  phone: string;
  addressText: string;
  serviceAreas: string[];
  // Interactive service-area geometry (admin-controlled). Center point + reach
  // in km; all null until an admin draws it on the map.
  serviceLat: number | null;
  serviceLng: number | null;
  serviceRadiusKm: number | null;
  acceptsCod: boolean;
  // The DB column is a plain text (no enum) — the create/edit routes restrict
  // writes to 'NPR'|'USD' via zod, but the row type reflects the schema.
  currency: string;
  isActive: boolean;
  createdAt: string;
  email: string;
  accountStatus: string;
  menuCount: number;
  activeOrders: number;
}
