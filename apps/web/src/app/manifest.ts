import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The GM Method',
    short_name: 'GM Method',
    description: 'Training, nutrition, progress, and coaching in one system.',
    start_url: '/',
    display: 'standalone',
    background_color: '#080808',
    theme_color: '#e32636',
    // The files have always been there, the manifest just never named them,
    // so installing the app to a home screen fell back to a screenshot.
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
