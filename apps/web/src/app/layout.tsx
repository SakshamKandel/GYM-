import type { Metadata } from 'next';
import { IBM_Plex_Mono, Oswald, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import './marketing.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gym-xi-tawny.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'The GM Method',
    template: '%s | The GM Method',
  },
  description: 'Training, food, progress, and real coaching in one fitness app.',
  applicationName: 'The GM Method',
  keywords: ['fitness coaching', 'workout tracker', 'nutrition tracker', 'GM Method'],
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'The GM Method',
    title: 'The GM Method',
    description: 'Training, food, progress, and real coaching in one fitness app.',
  },
  twitter: {
    card: 'summary',
    title: 'The GM Method',
    description: 'Training, food, progress, and real coaching in one fitness app.',
  },
};

// Poppins for headings/body, Oswald for numerals/dates/ids (web console design).
// Exposed as CSS variables consumed by globals.css.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-oswald',
  display: 'swap',
});

// Mono for marketing eyebrows / microlabels only (technical-label voice).
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plexmono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${oswald.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
