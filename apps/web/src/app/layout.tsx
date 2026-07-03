import type { Metadata } from 'next';
import { Oswald, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GYM Tracker API',
  description: 'Account API for the GM Method fitness app.',
};

// Poppins for headings/body, Oswald for numerals/dates/ids (web console design).
// Exposed as CSS variables consumed by globals.css.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-poppins',
  display: 'swap',
});

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-oswald',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${oswald.variable}`}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
