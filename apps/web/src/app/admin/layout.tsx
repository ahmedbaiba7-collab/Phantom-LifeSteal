'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ScrollText, Shield, Users } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, permission: 'analytics.read' },
  { href: '/admin/users', label: 'Users', icon: Users, permission: 'user.read' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read' },
  { href: '/admin/security', label: 'Security', icon: Shield, permission: 'security.read' },
];

/**
 * The client-side guard here is a courtesy, not a control. Every /admin API
 * route checks the same permissions server-side — hiding a link that the
 * server would refuse anyway is about not wasting someone's time, and nothing
 * sensitive is fetched before the check runs.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isStaff = user?.roles.some((r) => r.role.weight >= 60) ?? false;

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (!isStaff) router.replace('/dashboard');
  }, [loading, user, isStaff, router]);

  if (loading || !user || !isStaff) {
    return (
      <div className="container-page py-24">
        <div className="glass h-64 animate-pulse" aria-busy="true" aria-label="Checking access" />
      </div>
    );
  }

  const visible = NAV.filter((item) => can(item.permission));

  return (
    <div className="container-page py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="eyebrow">Staff</p>
          <h1 className="mt-3 font-display text-2xl font-bold uppercase tracking-wide">
            Control panel
          </h1>
        </div>
        <Link href="/dashboard" className="font-body text-sm text-muted hover:text-ink">
          Back to site
        </Link>
      </div>

      <div className="mt-9 grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Admin sections">
          <ul className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:flex-col lg:overflow-visible">
            {visible.map((item) => {
              const active =
                item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3.5 py-2.5 font-display text-xs font-bold uppercase tracking-widest transition-colors',
                      active
                        ? 'bg-neon/12 text-neon-hot'
                        : 'text-muted hover:bg-white/[0.03] hover:text-ink',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
