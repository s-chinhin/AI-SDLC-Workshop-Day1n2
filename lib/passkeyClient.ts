// Browser-side passkey helpers shared by the login page and the main app.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** Turns WebAuthn/browser errors into messages a person can act on. */
export function describePasskeyError(err: unknown): string {
  const name = (err as Error)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Passkey prompt was cancelled. Try again when ready.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for this account.';
  if (name === 'NotSupportedError') return "Your browser or device doesn't support passkeys.";
  return (err as Error)?.message || 'Something went wrong. Please try again.';
}

async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Runs the 4-step WebAuthn flow: options → browser prompt → verify. */
export async function passkeyFlow(mode: 'register' | 'login', username: string): Promise<void> {
  const options = await postJSON(`/api/auth/${mode}-options`, { username });
  const response =
    mode === 'register'
      ? await startRegistration({ optionsJSON: options })
      : await startAuthentication({ optionsJSON: options });
  await postJSON(`/api/auth/${mode}-verify`, { username, response });
}
