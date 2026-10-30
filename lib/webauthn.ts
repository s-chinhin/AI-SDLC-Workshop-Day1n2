import type { NextRequest } from 'next/server';

export const RP_NAME = process.env.RP_NAME ?? 'Todo App';

/** Relying-party ID and expected origin, from env or the incoming request. */
export function getRelyingParty(request: NextRequest): { rpID: string; origin: string } {
  const origin = process.env.ORIGIN ?? request.nextUrl.origin;
  return { rpID: process.env.RP_ID ?? new URL(origin).hostname, origin };
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,64}$/;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim();
  return USERNAME_PATTERN.test(username) ? username : null;
}

// ---------------------------------------------------------------------------
// Challenge store: single-use, 5-minute challenges keyed by flow + username.
// In-memory is fine for a single-instance deployment.
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
type Flow = 'register' | 'login';

const globalForChallenges = globalThis as unknown as {
  __webauthnChallenges?: Map<string, { challenge: string; expires: number }>;
};
const challenges = (globalForChallenges.__webauthnChallenges ??= new Map());

export function storeChallenge(flow: Flow, username: string, challenge: string): void {
  challenges.set(`${flow}:${username.toLowerCase()}`, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
}

/** Returns and deletes the challenge; null if missing or expired. */
export function consumeChallenge(flow: Flow, username: string): string | null {
  const key = `${flow}:${username.toLowerCase()}`;
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

export function parseTransports(value: string | null): AuthenticatorTransport[] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
