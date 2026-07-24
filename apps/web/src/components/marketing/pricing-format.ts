import type { PublicCatalog, PublicRegionCatalog } from '@/lib/publicCatalog';

export type Region = keyof PublicCatalog;

/** `amountMinor` → display string ("Rs 1,999" / "$9.99" / "Free"). */
export function formatPrice(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return 'Free';
  const major = amountMinor / 100;
  if (currency === 'NPR') return `Rs ${major.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return `$${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function priceFor(region: PublicRegionCatalog, tier: string): string {
  if (!region.available) return 'Unavailable';
  const row = region.tiers.find((t) => t.tier === tier);
  return row ? formatPrice(row.amountMinor, region.currency) : 'Unavailable';
}

export const TIER_META = [
  { tier: 'starter', name: 'Starter', blurb: 'Track training, food and progress yourself.' },
  { tier: 'silver', name: 'Silver', blurb: 'A verified coach programs your training.' },
  { tier: 'gold', name: 'Gold', blurb: 'Coached training plus a personal diet plan.' },
  { tier: 'elite', name: 'Elite', blurb: 'Full mentorship — chat with your coach any time.' },
] as const;
