import Link from 'next/link';
import { ArrowRight, Crown, Heart, ShieldOff, Swords, Users, Zap } from 'lucide-react';
import { serverFetch } from '@/lib/api';
import { HeartLedger, type Pulse, type Status } from '@/components/heart-ledger';
import { CopyIp } from '@/components/copy-ip';
import { Reveal } from '@/components/reveal';
import { compact, relativeTime } from '@/lib/format';

const SERVER_IP = process.env.NEXT_PUBLIC_SERVER_IP ?? 'play.lifestealphantom.com';
const DISCORD = process.env.NEXT_PUBLIC_DISCORD_URL ?? 'https://discord.gg/phantom';

interface NewsItem {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string | null;
}

interface LeaderRow {
  rank: number;
  username: string;
  rankName: string;
  rankColor: string;
  hearts: number;
  kills: number;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/** Revalidated rather than dynamic: everyone sees the same page, cached at the edge. */
export const revalidate = 60;

export default async function HomePage() {
  const [status, pulse, news, leaders, faqs] = await Promise.all([
    serverFetch<Status>('/server/status', 20),
    serverFetch<Pulse>('/server/pulse', 60),
    serverFetch<NewsItem[]>('/news?limit=3', 60),
    serverFetch<LeaderRow[]>('/leaderboards/hearts?limit=5', 60),
    serverFetch<FaqItem[]>('/faq', 600),
  ]);

  return (
    <>
      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-grid-fade bg-grid opacity-60
                     [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2
                     rounded-full bg-neon/12 blur-[130px]"
          aria-hidden
        />

        <div className="container-page relative grid gap-12 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-24">
          <div>
            <p className="eyebrow">Season 3 · Live now</p>

            <h1 className="mt-5 font-display text-display font-bold uppercase">
              Take a heart,
              <br />
              <span className="text-heart">or lose one.</span>
            </h1>

            <p className="mt-6 max-w-lg font-body text-base leading-relaxed text-muted sm:text-lg">
              Every kill moves a heart from one player to another. Permanently. Ranks buy you
              cosmetics and convenience — never a heart, never gear, never an advantage in a fight.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <CopyIp ip={SERVER_IP} />
              <Link href="/register" className="btn-primary">
                Create account
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a href={DISCORD} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                Discord
              </a>
            </div>

            {status?.maintenance && (
              <p className="mt-6 flex items-center gap-2 rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm text-ink">
                <ShieldOff className="h-4 w-4 shrink-0 text-heart" aria-hidden />
                The server is in maintenance. Follow Discord for the all-clear.
              </p>
            )}
          </div>

          <HeartLedger pulse={pulse} status={status} />
        </div>
      </section>

      {/* ───────────────────── What makes it different ───────────────────── */}
      <section className="container-page py-20">
        <Reveal>
          <p className="eyebrow">The rules that matter</p>
          <h2 className="mt-4 max-w-2xl font-display text-headline font-bold uppercase">
            Four decisions that shape every fight
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {[
            {
              icon: Heart,
              title: 'Hearts are never for sale',
              body: 'Not in the store, not in a crate, not for any amount of money. The only source of a heart is another player who had it first.',
              accent: true,
            },
            {
              icon: Swords,
              title: 'No combat log, no grace period',
              body: 'Disconnecting mid-fight leaves your body standing. Whatever you were carrying is on the ground the moment you lose.',
            },
            {
              icon: Crown,
              title: 'Twenty is the ceiling',
              body: 'Past twenty hearts, kills award heart shards instead — tradeable, spendable, and the closest thing to real currency here.',
            },
            {
              icon: Zap,
              title: 'Elimination lasts a day',
              body: 'Hit zero and you are locked out for 24 hours, unless a teammate spends a Revive Beacon on you. No permanent deletion.',
            },
          ].map((feature, i) => (
            <Reveal key={feature.title} delay={i * 0.06}>
              <article className="glass h-full p-6 transition-colors hover:border-neon/35">
                <feature.icon
                  className={`h-6 w-6 ${feature.accent ? 'text-heart' : 'text-neon'}`}
                  aria-hidden
                />
                <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wide">
                  {feature.title}
                </h3>
                <p className="mt-2.5 font-body text-sm leading-relaxed text-muted">{feature.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ───────────────────────── Heart holders ───────────────────────── */}
      {leaders && leaders.length > 0 && (
        <section className="container-page py-8">
          <Reveal>
            <div className="glass overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-edge px-6 py-5">
                <div>
                  <p className="eyebrow">Most hearts held</p>
                  <p className="mt-2 font-body text-sm text-muted">Updated every minute from live server stats.</p>
                </div>
                <Link
                  href="/leaderboards"
                  className="font-display text-xs font-bold uppercase tracking-widest text-neon hover:text-neon-hot"
                >
                  All boards
                </Link>
              </div>

              <table className="w-full">
                <caption className="sr-only">Players ranked by hearts held</caption>
                <thead>
                  <tr className="border-b border-edge/60 text-left">
                    <th scope="col" className="px-6 py-3 font-display text-eyebrow font-bold uppercase text-muted">#</th>
                    <th scope="col" className="px-2 py-3 font-display text-eyebrow font-bold uppercase text-muted">Player</th>
                    <th scope="col" className="px-2 py-3 text-right font-display text-eyebrow font-bold uppercase text-muted">Kills</th>
                    <th scope="col" className="px-6 py-3 text-right font-display text-eyebrow font-bold uppercase text-muted">Hearts</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row) => (
                    <tr key={row.username} className="border-b border-edge/30 last:border-0">
                      <td className="px-6 py-3.5 font-mono text-sm tabular text-muted">{row.rank}</td>
                      <td className="px-2 py-3.5">
                        <Link href={`/players/${row.username}`} className="font-display text-sm font-bold uppercase tracking-wide hover:text-neon-hot">
                          {row.username}
                        </Link>
                        <span className="ml-2 font-body text-xs" style={{ color: row.rankColor }}>
                          {row.rankName}
                        </span>
                      </td>
                      <td className="px-2 py-3.5 text-right font-mono text-sm tabular text-muted">{row.kills}</td>
                      <td className="px-6 py-3.5 text-right font-mono text-sm tabular text-heart">{row.hearts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>
      )}

      {/* ───────────────────────── News ───────────────────────── */}
      {news && news.length > 0 && (
        <section className="container-page py-16">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Latest</p>
                <h2 className="mt-4 font-display text-headline font-bold uppercase">From the server</h2>
              </div>
              <Link href="/news" className="btn-ghost hidden py-2.5 text-xs sm:inline-flex">
                All posts
              </Link>
            </div>
          </Reveal>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {news.map((post, i) => (
              <Reveal key={post.slug} delay={i * 0.06}>
                <Link href={`/news/${post.slug}`} className="glass block h-full p-6 transition-colors hover:border-neon/35">
                  <p className="font-display text-eyebrow font-bold uppercase text-neon">{post.category}</p>
                  <h3 className="mt-3 font-display text-lg font-bold uppercase leading-tight tracking-wide">
                    {post.title}
                  </h3>
                  <p className="mt-2.5 line-clamp-3 font-body text-sm leading-relaxed text-muted">
                    {post.excerpt}
                  </p>
                  {post.publishedAt && (
                    <p className="mt-4 font-mono text-xs tabular text-muted/70">
                      {relativeTime(post.publishedAt)}
                    </p>
                  )}
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ───────────────────────── FAQ ───────────────────────── */}
      {faqs && faqs.length > 0 && (
        <section className="container-page py-16">
          <Reveal>
            <p className="eyebrow">Before you ask</p>
            <h2 className="mt-4 font-display text-headline font-bold uppercase">Common questions</h2>
          </Reveal>

          <div className="mt-10 divide-y divide-edge/50 border-y border-edge/50">
            {faqs.slice(0, 6).map((faq, i) => (
              <Reveal key={faq.id} delay={i * 0.04}>
                <details className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6">
                    <h3 className="font-display text-base font-bold uppercase tracking-wide">
                      {faq.question}
                    </h3>
                    <span className="shrink-0 font-mono text-xl text-neon transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-muted">
                    {faq.answer}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ───────────────────────── Join ───────────────────────── */}
      <section className="container-page py-20">
        <Reveal>
          <div className="glass relative overflow-hidden px-6 py-14 text-center sm:px-12">
            <div
              className="pointer-events-none absolute inset-x-0 -bottom-24 h-56 bg-neon/12 blur-[100px]"
              aria-hidden
            />
            <div className="relative">
              <Users className="mx-auto h-7 w-7 text-neon" aria-hidden />
              <h2 className="mt-5 font-display text-headline font-bold uppercase">
                {pulse ? `${compact(pulse.registered)} players in` : 'The server is open'}
              </h2>
              <p className="mx-auto mt-4 max-w-md font-body text-sm leading-relaxed text-muted">
                Java Edition 1.21 and above. Bedrock on port 19132. No whitelist, no application,
                no waiting.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <CopyIp ip={SERVER_IP} />
                <Link href="/register" className="btn-primary">Create account</Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
