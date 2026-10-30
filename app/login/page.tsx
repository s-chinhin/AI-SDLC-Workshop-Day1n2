'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';
import { describePasskeyError, passkeyFlow } from '@/lib/passkeyClient';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<'register' | 'login' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    // Already signed in (e.g. via back button) → go to the app.
    fetch('/api/auth/me').then((res) => res.ok && router.replace('/'));

    const supported = browserSupportsWebAuthn();
    (supported ? platformAuthenticatorIsAvailable() : Promise.resolve(false)).then((available) => {
      if (!supported) {
        setWarning("This browser doesn't support passkeys. Try a recent Chrome, Edge, Safari or Firefox.");
      } else if (!available) {
        setWarning(
          'No built-in passkey authenticator was found. On Windows, set up Windows Hello (PIN, fingerprint or face) in Settings → Accounts → Sign-in options, or use a phone or security key.'
        );
      }
    });
  }, [router]);

  async function run(mode: 'register' | 'login') {
    setError(null);
    const name = username.trim();
    if (!name) return setError('Enter a username');
    setBusy(mode);
    try {
      // Session cookie is set by the verify call before we navigate, so the proxy lets us through.
      await passkeyFlow(mode, name);
      router.replace('/');
    } catch (err) {
      setError(describePasskeyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run('login');
        }}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Todo App</h1>
          <p className="text-sm text-gray-500">Sign in with a passkey. No password needed.</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username webauthn"
            autoFocus
            aria-label="Username"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </label>

        {warning && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300" data-testid="passkey-warning">
            {warning}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'login' ? 'Waiting for passkey…' : 'Login'}
          </button>
          <button
            type="button"
            onClick={() => run('register')}
            disabled={busy !== null}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {busy === 'register' ? 'Waiting for passkey…' : 'Register'}
          </button>
        </div>
      </form>
    </main>
  );
}
