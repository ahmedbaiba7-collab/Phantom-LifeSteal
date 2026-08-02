'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { ApiRequestError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, completeTwoFactor } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    try {
      if (challengeToken) {
        await completeTwoFactor(challengeToken, code);
        router.push('/dashboard');
        return;
      }

      const result = await signIn(email, password);
      if (result.twoFactorRequired && result.challengeToken) {
        setChallengeToken(result.challengeToken);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      // Errors explain what happened and what to do — never apologise, never
      // reveal whether the address exists.
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

  return (
    <div className="container-page flex min-h-[80vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Welcome back</p>
        <h1 className="mt-4 font-display text-headline font-bold uppercase">
          {challengeToken ? 'One more step' : 'Sign in'}
        </h1>

        <form onSubmit={submit} className="glass mt-8 space-y-5 p-7" noValidate>
          {error && (
            <p role="alert" className="rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm">
              {error}
            </p>
          )}

          {challengeToken ? (
            <div>
              <label htmlFor="code" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
                Authenticator code
              </label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="field font-mono tabular tracking-[0.3em]"
                placeholder="000000"
              />
              <p className="mt-2 font-body text-xs text-muted">
                Enter the six-digit code from your authenticator app, or one of your recovery codes.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="email" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fields.email)}
                  className={`field ${fields.email ? 'field-error' : ''}`}
                />
                {fields.email && <p className="mt-1.5 font-body text-xs text-heart">{fields.email}</p>}
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <label htmlFor="password" className="block font-display text-eyebrow font-bold uppercase text-muted">
                    Password
                  </label>
                  <Link href="/forgot-password" className="font-body text-xs text-neon hover:text-neon-hot">
                    Forgot it?
                  </Link>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`field ${fields.password ? 'field-error' : ''}`}
                />
              </div>
            </>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Working…' : challengeToken ? 'Verify and continue' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center font-body text-sm text-muted">
          No account yet?{' '}
          <Link href="/register" className="font-medium text-neon hover:text-neon-hot">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
