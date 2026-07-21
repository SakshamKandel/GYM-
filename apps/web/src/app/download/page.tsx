import type { Metadata } from 'next';
import { Shell } from '@/components/marketing/Shell';
import { DownloadCrossLinks } from '@/components/marketing/download/CrossLinks';
import { DownloadCta } from '@/components/marketing/download/Cta';
import { DownloadHero } from '@/components/marketing/download/Hero';
import { OfflineFirst } from '@/components/marketing/download/OfflineFirst';
import { DownloadPhoto } from '@/components/marketing/download/Photo';
import { Requirements } from '@/components/marketing/download/Requirements';
import { StoreRow } from '@/components/marketing/download/StoreRow';
import { WhatYouGet } from '@/components/marketing/download/WhatYouGet';

export const metadata: Metadata = {
  title: 'Download The GM Method — iOS & Android, offline-first',
  description:
    'Get The GM Method for iOS and Android. Use the whole tracker without an account, log every set offline, and start on a free Starter tier. App stores launching soon — join early access.',
};

export default function DownloadPage() {
  return (
    <Shell>
      <DownloadHero />
      <StoreRow />
      <WhatYouGet />
      <OfflineFirst />
      <Requirements />
      <DownloadPhoto />
      <DownloadCrossLinks />
      <DownloadCta />
    </Shell>
  );
}
