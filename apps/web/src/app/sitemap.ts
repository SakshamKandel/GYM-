import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gym-xi-tawny.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: siteUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/training`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/nutrition`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/progress`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/coaching`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/meals`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/gyms`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/partners`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${siteUrl}/for-coaches`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${siteUrl}/download`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/about`, lastModified, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${siteUrl}/contact`, lastModified, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${siteUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${siteUrl}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
  ];
}
