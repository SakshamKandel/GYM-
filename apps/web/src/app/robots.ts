import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gym-xi-tawny.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/privacy', '/terms', '/contact'],
        disallow: ['/api/', '/admin/', '/coach/', '/partner/', '/reset-password'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
