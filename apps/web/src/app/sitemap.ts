import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gym-xi-tawny.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: siteUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${siteUrl}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${siteUrl}/contact`, lastModified, changeFrequency: 'yearly', priority: 0.6 },
  ];
}
