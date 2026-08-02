import { env } from '../config/env';

/**
 * Whether the browser will treat site → API requests as cross-site.
 *
 * Cookies are scoped by registrable domain, not by exact host. So
 * `site.com` → `api.site.com` is same-site and `SameSite=Lax` works, while
 * `a.vercel.app` → `b.vercel.app` is NOT — hosting providers put their shared
 * domains on the Public Suffix List precisely so one customer cannot set a
 * cookie readable by another. Treating those as same-site would leave the
 * refresh cookie silently dropped, and the symptom is users who log in and are
 * immediately logged out with no error anywhere.
 *
 * Deploying both halves under one domain you own is the better arrangement,
 * and this flag will be false when you do. Until then it flips the cookies to
 * `SameSite=None`, which browsers only honour together with `Secure`.
 */
const PUBLIC_SUFFIXES = [
  'vercel.app',
  'onrender.com',
  'netlify.app',
  'railway.app',
  'fly.dev',
  'koyeb.app',
  'herokuapp.com',
  'github.io',
  'pages.dev',
  'workers.dev',
];

function cookieScope(urlString: string): string {
  const { hostname } = new URL(urlString);

  // Under a public suffix, only the exact host shares a cookie scope.
  for (const suffix of PUBLIC_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return hostname;
  }

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  // Good enough for ordinary domains. Multi-part suffixes like .co.uk would
  // report one label too few, which errs toward cross-site — the safe way to
  // be wrong, since SameSite=None still works, just with weaker CSRF defence
  // in depth. The double-submit CSRF token covers that regardless.
  return parts.slice(-2).join('.');
}

export const isCrossSite = cookieScope(env.WEB_ORIGIN) !== cookieScope(env.API_ORIGIN);

/** SameSite=None is only accepted alongside Secure, so the two move together. */
export const sameSitePolicy = isCrossSite ? ('none' as const) : ('lax' as const);
export const cookieSecure = env.NODE_ENV === 'production' || isCrossSite;
