import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { authenticatorDB, userDB } from '@/lib/db';
import { getRelyingParty, normalizeUsername, parseTransports, storeChallenge } from '@/lib/webauthn';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const user = username ? userDB.findByUsername(username) : undefined;
  const authenticators = user ? authenticatorDB.findByUserId(user.id) : [];
  if (!user || authenticators.length === 0) {
    return NextResponse.json({ error: 'No passkey found for that username' }, { status: 404 });
  }

  const { rpID } = getRelyingParty(request);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: authenticators.map((a) => ({
      id: a.credential_id,
      transports: parseTransports(a.transports),
    })),
    userVerification: 'preferred',
  });

  storeChallenge('login', user.username, options.challenge);
  return NextResponse.json(options);
}
