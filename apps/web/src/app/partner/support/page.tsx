import type { Metadata } from 'next';
import { PageHeader } from '@/components/console';
import { getDb } from '@/lib/db';
import { PartnerSupportThread } from '../_components/PartnerSupportThread';
import { loadPartnerSupportThread, requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Message the team' };
export const dynamic = 'force-dynamic';

/**
 * The restaurant's line to the platform team.
 *
 * Several places in this portal used to say "contact admin support", which did
 * not exist for a partner: support tickets are opened from inside the member
 * app and a restaurant has no member app. This page is that channel, and it
 * writes into the same inbox staff already answer, so nothing here promises a
 * conversation that has nowhere to arrive.
 *
 * `?about=GM-XXXX` pre-fills the box from the feedback page, so a restaurant
 * answering a reported problem does not have to copy the order number by hand.
 */
export default async function PartnerSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ about?: string | string[] }>;
}) {
  const { principal, partnerName } = await requirePartnerPage();
  const messages = await loadPartnerSupportThread(getDb(), principal.id);

  const aboutParam = (await searchParams).about;
  const about = (Array.isArray(aboutParam) ? aboutParam[0] : aboutParam)?.trim() ?? '';

  return (
    <div style={{ width: '100%', maxWidth: 820 }}>
      <PageHeader
        title="Message the team"
        subtitle={`${partnerName} · Ask about your service area, an order, a payout, or anything else.`}
      />
      <PartnerSupportThread initialMessages={messages} about={about} />
    </div>
  );
}
