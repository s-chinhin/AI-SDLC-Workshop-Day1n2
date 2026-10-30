// JWT session tokens. Kept free of database imports so proxy.ts can use it.
import { SignJWT, jwtVerify } from 'jose';

export interface Session {
  userId: number;
  username: string;
}

export const SESSION_COOKIE = 'session';
export const SESSION_DAYS = 7;

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return new TextEncoder().encode(secret ?? 'dev-only-insecure-secret-change-me');
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ userId: session.userId, username: session.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

/** Fails closed: any missing, tampered, or expired token yields null. */
export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') return null;
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}
