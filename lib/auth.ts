import { cookies } from 'next/headers';
import { userDB, type User } from './db';
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySessionToken, type Session } from './session';

export type { Session } from './session';

/** Reads the session cookie. Returns null if missing, invalid, expired, or the user no longer exists. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session || !userDB.findById(session.userId)) return null;
  return session;
}

export async function createSession(user: Pick<User, 'id' | 'username'>): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession({ userId: user.id, username: user.username }), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure in production unless explicitly disabled (e.g. the Playwright server on plain http).
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
