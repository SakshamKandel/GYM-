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
  };
}
