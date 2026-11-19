import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agrimate',
    short_name: 'Agrimate',
    description: 'B2B agri-trade for farmers, FPOs and bulk buyers.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f7f6f1',
    theme_color: '#1f563d',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
