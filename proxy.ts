import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

// Protects the app pages: signed-out visitors go to /login, signed-in users skip it.
export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  if (pathname === '/login') {
    return session ? NextResponse.redirect(new URL('/', request.url)) : NextResponse.next();
  }
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar', '/login'],
};
