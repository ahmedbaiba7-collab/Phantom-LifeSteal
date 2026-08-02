import type { MetadataRoute } from 'next';
import { serverFetch } from '@/lib/api';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifestealphantom.com';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'hourly', priority: 1 },
    { url: `${siteUrl}/store`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${siteUrl}/leaderboards`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${siteUrl}/vote`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/news`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/wiki`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${siteUrl}/support`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const [posts, wiki] = await Promise.all([
    serverFetch<{ slug: string; publishedAt: string | null }[]>('/news?limit=50', 3600),
    serverFetch<{ articles: { slug: string; updatedAt: string }[] }[]>('/wiki', 3600),
  ]);

  const newsRoutes: MetadataRoute.Sitemap = (posts ?? []).map((post) => ({
    url: `${siteUrl}/news/${post.slug}`,
    lastModified: post.publishedAt ? new Date(post.publishedAt) : undefined,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const wikiRoutes: MetadataRoute.Sitemap = (wiki ?? []).flatMap((category) =>
    category.articles.map((article) => ({
      url: `${siteUrl}/wiki/${article.slug}`,
      lastModified: new Date(article.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  );

  return [...staticRoutes, ...newsRoutes, ...wikiRoutes];
}
