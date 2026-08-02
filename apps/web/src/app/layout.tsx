import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Sora, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { AuthProvider } from '@/components/auth-provider';

/**
 * Chakra Petch for display: angular and chamfered, it reads as gaming hardware
 * rather than a birthday party — the "Minecraft inspired without looking
 * childish" line in the brief, solved in type instead of in decoration.
 */
const display = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const body = Sora({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

/** Stats and leaderboards are tables of numbers, so the numbers are tabular. */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lifestealphantom.com';
const serverIp = process.env.NEXT_PUBLIC_SERVER_IP ?? 'play.lifestealphantom.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'LifeSteal Phantom — take a heart, or lose one',
    template: '%s · LifeSteal Phantom',
  },
  description:
    `A LifeSteal server where every kill moves a heart between two players. No resets, no pay-to-win hearts. Join at ${serverIp}.`,
  keywords: ['lifesteal', 'minecraft server', 'lifesteal smp', 'minecraft pvp', 'phantom'],
  applicationName: 'LifeSteal Phantom',
  authors: [{ name: 'LifeSteal Phantom' }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'LifeSteal Phantom',
    title: 'LifeSteal Phantom — take a heart, or lose one',
    description: 'Every kill moves a heart. Hearts cannot be bought at any price.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'LifeSteal Phantom' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LifeSteal Phantom',
    description: 'Every kill moves a heart. Hearts cannot be bought at any price.',
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#07060B',
  width: 'device-width',
  initialScale: 1,
};

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: 'LifeSteal Phantom',
      description: 'Official site of the LifeSteal Phantom Minecraft network.',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/wiki?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'VideoGame',
      name: 'LifeSteal Phantom',
      gamePlatform: 'Minecraft: Java Edition',
      applicationCategory: 'Game',
      url: siteUrl,
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-void">
        {/* First stop for keyboard and screen-reader users. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50
                     focus:rounded-lg focus:bg-neon focus:px-4 focus:py-2 focus:font-display
                     focus:text-sm focus:font-bold focus:text-void"
        >
          Skip to content
        </a>

        <AuthProvider>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </AuthProvider>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
