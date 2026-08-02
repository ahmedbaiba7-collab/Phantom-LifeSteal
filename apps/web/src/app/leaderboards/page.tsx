import Link from 'next/link';
import type { Metadata } from 'next';
import { serverFetch } from '@/lib/api';
import { count } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Leaderboards',
  description: 'Who holds the most hearts, who has taken the most, and who has survived the longest.',
};

export const revalidate = 60;

const BOARDS = [
  { key: 'hearts', label: 'Hearts held', column: 'hearts', unit: '' },
  { key: 'kills', label: 'Kills', column: 'kills', unit: '' },
  { key: 'kdr', label: 'K/D ratio', column: 'kdr', unit: '' },
  { key: 'streak', label: 'Best streak', column: 'bestStreak', unit: '' },
  { key: 'playtime', label: 'Playtime', column: 'playtimeHours', unit: 'h' },
  { key: 'balance', label: 'Richest', column: 'balance', unit: ' coins' },
  { key: 'votes', label: 'Votes', column: 'votes', unit: '' },
] as const;

interface Row {
  rank: number;
  username: string;
  rankName: string;
  rankColor: string;
  avatar: string;
  kills: number;
  deaths: number;
  kdr: number;
  hearts: number;
  balance: number;
  playtimeHours: number;
  bestStreak: number;
  votes: number;
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const params = await searchParams;
  const active = BOARDS.find((b) => b.key === params.board) ?? BOARDS[0];
  const rows = await serverFetch<Row[]>(`/leaderboards/${active.key}?limit=50`, 60);

  return (
    <div className="container-page py-16">
      <p className="eyebrow">Standings</p>
      <h1 className="mt-4 font-display text-headline font-bold uppercase">Leaderboards</h1>
      <p className="mt-4 max-w-xl font-body text-sm leading-relaxed text-muted">
        Pulled from live server stats every minute. Only players who have linked their Minecraft
        account appear here.
      </p>

      <nav className="mt-9 flex flex-wrap gap-2" aria-label="Leaderboard categories">
        {BOARDS.map((board) => (
          <Link
            key={board.key}
            href={`/leaderboards?board=${board.key}`}
            aria-current={board.key === active.key ? 'page' : undefined}
            className={`rounded-lg border px-4 py-2 font-display text-xs font-bold uppercase tracking-widest transition-colors ${
              board.key === active.key
                ? 'border-neon/50 bg-neon/12 text-neon-hot'
                : 'border-edge text-muted hover:border-neon/30 hover:text-ink'
            }`}
          >
            {board.label}
          </Link>
        ))}
      </nav>

      {!rows || rows.length === 0 ? (
        <div className="glass mt-10 p-12 text-center">
          <h2 className="font-display text-lg font-bold uppercase">Nothing here yet</h2>
          <p className="mx-auto mt-3 max-w-sm font-body text-sm text-muted">
            This board fills up as players link their accounts and play. Link yours from the
            dashboard and you could be first on it.
          </p>
          <Link href="/dashboard" className="btn-primary mt-7">Link my account</Link>
        </div>
      ) : (
        <div className="glass mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <caption className="sr-only">Top players by {active.label}</caption>
            <thead>
              <tr className="border-b border-edge text-left">
                <th scope="col" className="px-5 py-4 font-display text-eyebrow font-bold uppercase text-muted">Rank</th>
                <th scope="col" className="px-2 py-4 font-display text-eyebrow font-bold uppercase text-muted">Player</th>
                <th scope="col" className="px-2 py-4 text-right font-display text-eyebrow font-bold uppercase text-muted">K / D</th>
                <th scope="col" className="px-5 py-4 text-right font-display text-eyebrow font-bold uppercase text-muted">
                  {active.label}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.username} className="border-b border-edge/30 transition-colors last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3.5">
                    <span
                      className={`font-mono text-sm tabular ${
                        row.rank <= 3 ? 'font-medium text-neon-hot' : 'text-muted'
                      }`}
                    >
                      {String(row.rank).padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-2 py-3.5">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.avatar}
                        alt=""
                        width={28}
                        height={28}
                        loading="lazy"
                        className="rounded border border-edge"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/players/${row.username}`}
                          className="block truncate font-display text-sm font-bold uppercase tracking-wide hover:text-neon-hot"
                        >
                          {row.username}
                        </Link>
                        <span className="font-body text-xs" style={{ color: row.rankColor }}>
                          {row.rankName}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3.5 text-right font-mono text-sm tabular text-muted">
                    {row.kills} / {row.deaths}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={`font-mono text-sm tabular ${
                        active.key === 'hearts' ? 'text-heart' : 'text-ink'
                      }`}
                    >
                      {count(row[active.column as keyof Row] as number)}
                      {active.unit}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
