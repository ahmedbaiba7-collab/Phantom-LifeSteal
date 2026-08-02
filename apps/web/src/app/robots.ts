import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifestealphantom.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Account and staff areas are behind auth anyway; keeping them out of the
        // index avoids leaking URL structure and wasting crawl budget.
        disallow: ['/dashboard', '/settings', '/admin', '/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
