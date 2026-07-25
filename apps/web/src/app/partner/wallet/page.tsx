import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retired route. Wallet and Earnings both answered "how much am I owed", with
 * different figures and different framing, so the answer now lives in ONE place
 * (/partner/earnings — balance, payout request, and payout history at the top,
 * sales below). This stub stays so old bookmarks still land on that answer.
 */
export default function PartnerWalletPage(): never {
  redirect('/partner/earnings');
}
