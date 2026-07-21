'use client';

/**
 * Marketing Footer — clean, professional, matching mobile app design tokens (@gym/ui-tokens),
 * multi-column sitemap, brand assets, and app store CTA band.
 */
import Link from 'next/link';
import { Container, LogoMark, PillLink, Wordmark } from './ui';

const FOOTER_NAV = [
  {
    title: 'App Modules',
    links: [
      { label: 'Training & Gym Mode', href: '/training' },
      { label: 'Food & Barcode Scan', href: '/nutrition' },
      { label: 'Progress & Weight Trend', href: '/progress' },
      { label: 'Meals & Healthy Delivery', href: '/meals' },
      { label: 'Gym Finder & Day Passes', href: '/gyms' },
      { label: 'Download App', href: '/download' },
    ],
  },
  {
    title: 'Coaching & Tiers',
    links: [
      { label: '1-on-1 Human Coaching', href: '/coaching' },
      { label: 'Become a Verified Coach', href: '/for-coaches' },
      { label: 'Membership Tiers', href: '/pricing' },
      { label: 'Nepal Regional Pricing', href: '/pricing#nepal' },
      { label: 'eSewa & Khalti Payments', href: '/pricing#payment' },
    ],
  },
  {
    title: 'Company & Network',
    links: [
      { label: 'About The GM Method', href: '/about' },
      { label: 'Partner Restaurants & Gyms', href: '/partners' },
      { label: 'Support & Help Inbox', href: '/contact' },
    ],
  },
  {
    title: 'Console Portals',
    links: [
      { label: 'Coach Portal', href: '/coach/login' },
      { label: 'Partner Portal', href: '/partner/login' },
      { label: 'Admin Command Center', href: '/admin/login' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mkt-noise relative overflow-hidden bg-ink border-t border-line-strong/40 pt-16 pb-12 text-snow">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-red/15 via-transparent to-transparent pointer-events-none" />

      <Container wide className="relative z-10">
        {/* Top App Callout Card */}
        <div className="rounded-[26px] bg-gradient-to-r from-charcoal to-charcoal-2 p-8 md:p-12 border border-line-strong/40 shadow-pop mb-16 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <span className="rounded-full bg-red px-3.5 py-1 text-[11px] font-bold text-ink uppercase tracking-wider">
              Offline-First Fitness App
            </span>
            <h3 className="font-display text-3xl md:text-5xl font-medium uppercase text-snow mt-3">
              Ready to level up your training?
            </h3>
            <p className="text-dim text-[15px] mt-2 max-w-xl">
              Get the iOS or Android app today. Track sets instantly, scan food barcodes, and get macro-counted meals delivered.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 shrink-0">
            <PillLink href="/download" variant="red">
              Get the app
            </PillLink>
            <PillLink href="/pricing" variant="ghost">
              View Plans
            </PillLink>
          </div>
        </div>

        {/* Brand header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 pb-12 border-b border-line-strong/30">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark size={44} />
              <Wordmark className="text-2xl text-snow" />
            </div>
            <p className="mt-3 text-dim text-[15px] max-w-sm">
              Workouts, food tracking, meal delivery, gyms, and verified 1-on-1 human coaching in one unified app.
            </p>
          </div>
        </div>

        {/* Sitemap Navigation Columns */}
        <div className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
          {FOOTER_NAV.map((col) => (
            <div key={col.title}>
              <h4 className="font-sans text-[12px] uppercase tracking-wider text-red font-bold mb-4">
                {col.title}
              </h4>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[14px] text-dim hover:text-snow transition-colors duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-line-strong/30 flex items-center justify-between font-sans text-[13px] text-faint">
          <p>© 2026 The GM Method. All rights reserved.</p>
        </div>
      </Container>
    </footer>
  );
}
