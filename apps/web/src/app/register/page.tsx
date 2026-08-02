'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiRequestError } from '@/lib/api';

/** Live feedback on password quality, shown as met/unmet rather than a score bar. */
function strengthChecks(password: string, username: string) {
  return [
    { label: 'At least 10 characters', met: password.length >= 10 },
    { label: 'A letter and a number', met: /[a-zA-Z]/.test(password) && /[0-9]/.test(password) },
    {
      label: 'Not your username',
      met: password.length > 0 && (!username || !password.toLowerCase().includes(username.toLowerCase())),
    },
  ];
}

export default function RegisterPage() {
  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const checks = useMemo(() => strengthChecks(form.password, form.username), [form.password, form.username]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    try {
      await api('/auth/register', { method: 'POST', body: form, retryOnExpiry: false });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFields(err.fields);
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="container-page flex min-h-[80vh] items-center justify-center py-16">
        <div className="glass w-full max-w-md p-8 text-center">
          <h1 className="font-display text-headline font-bold uppercase">Check your email</h1>
          <p className="mt-4 font-body text-sm leading-relaxed text-muted">
            A confirmation link is on its way to{' '}
            <span className="font-mono text-ink">{form.email}</span>. Open it to activate your
            account — the link works for 24 hours.
          </p>
          <Link href="/login" className="btn-ghost mt-8 w-full">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page flex min-h-[80vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Ten hearts, starting now</p>
        <h1 className="mt-4 font-display text-headline font-bold uppercase">Create account</h1>

        <form onSubmit={submit} className="glass mt-8 space-y-5 p-7" noValidate>
          {error && (
            <p role="alert" className="rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm">
              {error}
            </p>
          )}

          <div>
            <label htmlFor="username" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              required
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              aria-invalid={Boolean(fields.username)}
              className={`field ${fields.username ? 'field-error' : ''}`}
            />
            {fields.username && <p className="mt-1.5 font-body text-xs text-heart">{fields.username}</p>}
          </div>

          <div>
            <label htmlFor="email" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              aria-invalid={Boolean(fields.email)}
              className={`field ${fields.email ? 'field-error' : ''}`}
            />
            {fields.email && <p className="mt-1.5 font-body text-xs text-heart">{fields.email}</p>}
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              aria-describedby="password-requirements"
              className={`field ${fields.password ? 'field-error' : ''}`}
            />
            <ul id="password-requirements" className="mt-3 space-y-1.5">
              {checks.map((check) => (
                <li key={check.label} className="flex items-center gap-2 font-body text-xs">
                  <span aria-hidden className={check.met ? 'text-neon' : 'text-muted/50'}>
                    {check.met ? '✓' : '·'}
                  </span>
                  <span className={check.met ? 'text-ink' : 'text-muted'}>{check.label}</span>
                </li>
              ))}
            </ul>
            {fields.password && <p className="mt-1.5 font-body text-xs text-heart">{fields.password}</p>}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={form.confirmPassword}
              onChange={(e) => update('confirmPassword', e.target.value)}
              className={`field ${fields.confirmPassword ? 'field-error' : ''}`}
            />
            {fields.confirmPassword && (
              <p className="mt-1.5 font-body text-xs text-heart">{fields.confirmPassword}</p>
            )}
          </div>

          <label className="flex items-start gap-3 font-body text-sm text-muted">
            <input
              type="checkbox"
              required
              checked={form.acceptTerms}
              onChange={(e) => update('acceptTerms', e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-edge bg-void accent-neon"
            />
            <span>
              I have read the{' '}
              <Link href="/wiki/server-rules" className="text-neon hover:text-neon-hot">server rules</Link> and the{' '}
              <Link href="/terms" className="text-neon hover:text-neon-hot">terms</Link>.
            </span>
          </label>

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center font-body text-sm text-muted">
          Already have one?{' '}
          <Link href="/login" className="font-medium text-neon hover:text-neon-hot">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
