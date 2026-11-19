import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// Only the public pages are worth indexing; everything else needs a login anyway.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: ['/$', '/login', '/signup'], disallow: '/' },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
