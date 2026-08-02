const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = `${API_URL}/api/v1`;

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
  requestId?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiError,
  ) {
    super(payload.message);
    this.name = 'ApiRequestError';
  }

  /** Field-level messages, ready to attach to inputs. */
  get fields(): Record<string, string> {
    return this.payload.details ?? {};
  }
}

/**
 * The access token lives in a module variable, never in localStorage.
 *
 * localStorage is readable by any script on the page, so a single XSS turns
 * into a stolen session that survives a browser restart. Held in memory, the
 * token dies with the tab, and the long-lived credential is an HttpOnly cookie
 * that JavaScript cannot touch at all.
 */
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)phantom_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/**
 * Refreshes at most once no matter how many requests fail concurrently — five
 * parallel 401s must not trigger five rotations, which reuse detection would
 * correctly read as an attack.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': readCsrfCookie() },
      });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const json = (await res.json()) as { data: { accessToken: string } };
      accessToken = json.data.accessToken;
      return accessToken;
    } catch {
      accessToken = null;
      return null;
    } finally {
      // Cleared on the next tick so concurrent callers all see the same promise.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set false for calls that must not attempt a token refresh (login, refresh). */
  retryOnExpiry?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, retryOnExpiry = true, headers, ...rest } = options;

  const send = async (token: string | null): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-csrf-token': readCsrfCookie(),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let response = await send(accessToken);

  if (response.status === 401 && retryOnExpiry) {
    const fresh = await refreshAccessToken();
    if (fresh) response = await send(fresh);
  }

  if (!response.ok) {
    let payload: ApiError = { code: 'UNKNOWN', message: 'Something went wrong. Try again.' };
    try {
      const json = (await response.json()) as { error?: ApiError };
      if (json.error) payload = json.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiRequestError(response.status, payload);
  }

  if (response.status === 204) return undefined as T;

  const json = (await response.json()) as { data: T };
  return json.data;
}

/**
 * Server-side fetch for React Server Components. No cookies, no tokens — this
 * only ever reads public content, and the caching hint is explicit at the call
 * site rather than inherited by accident.
 */
export async function serverFetch<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      next: { revalidate: revalidateSeconds },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: T };
    return json.data;
  } catch {
    // A page must still render when the API is unreachable. Callers handle null
    // by showing a degraded state rather than an error screen.
    return null;
  }
}
