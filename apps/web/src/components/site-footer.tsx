import Link from 'next/link';
import { CopyIp } from './copy-ip';

const SERVER_IP = process.env.NEXT_PUBLIC_SERVER_IP ?? 'play.lifestealphantom.com';
const DISCORD = process.env.NEXT_PUBLIC_DISCORD_URL ?? 'https://discord.gg/phantom';

const COLUMNS = [
  {
    heading: 'Play',
    links: [
      { href: '/store', label: 'Store' },
      { href: '/vote', label: 'Vote' },
      { href: '/leaderboards', label: 'Leaderboards' },
      { href: '/wiki/how-lifesteal-works', label: 'How it works' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { href: '/support', label: 'Open a ticket' },
      { href: '/support/appeal', label: 'Appeal a ban' },
      { href: '/wiki/server-rules', label: 'Rules' },
      { href: '/wiki', label: 'Wiki' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/refunds', label: 'Refunds' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-edge bg-panel/40">
      <div className="container-page grid gap-12 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="font-display text-lg font-bold uppercase tracking-[0.18em]">
            LifeSteal <span className="text-neon">Phantom</span>
          </p>
          <p className="mt-3 max-w-xs font-body text-sm leading-relaxed text-muted">
            A LifeSteal server where hearts move between players and cannot be bought at any price.
          </p>
          <CopyIp ip={SERVER_IP} className="mt-5 w-fit" />
        </div>

        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <p className="eyebrow">{col.heading}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="font-body text-sm text-muted transition-colors hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rule" />

      <div className="container-page flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-body text-xs text-muted">
          © {new Date().getFullYear()} LifeSteal Phantom. Not affiliated with Mojang or Microsoft.
        </p>
        <a
          href={DISCORD}
          target="_blank"
          rel="noopener noreferrer"
          className="font-display text-xs font-bold uppercase tracking-widest text-neon transition-colors hover:text-neon-hot"
        >
          Join the Discord
        </a>
      </div>
    </footer>
  );
}
