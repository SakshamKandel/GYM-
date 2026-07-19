import { PageHeader } from '@/components/console';
import { VerifyMember } from '../_components/VerifyMember';
import { requirePartnerPage } from '../_data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Verify member — the counter-side companion of the app's /membership-card
 * screen. A customer shows their card + member code; staff type it here and
 * get first name, tier, and validity so the member discount can be applied on
 * the spot. The API behind it is PII-minimal and rate-limited.
 */
export default async function PartnerVerifyPage() {
  await requirePartnerPage();

  return (
    <div>
      <PageHeader
        title="Verify member"
        subtitle="Type the member code from a customer's membership card to confirm their tier before applying the member discount."
      />
      <VerifyMember />
    </div>
  );
}
