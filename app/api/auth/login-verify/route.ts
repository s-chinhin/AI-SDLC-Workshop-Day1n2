import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { createSession } from '@/lib/auth';
import { authenticatorDB, userDB } from '@/lib/db';
import { consumeChallenge, getRelyingParty, normalizeUsername, parseTransports } from '@/lib/webauthn';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const credentialId = body.response?.id;
  if (!username || typeof credentialId !== 'string') {
    return NextResponse.json({ error: 'Invalid login request' }, { status: 400 });
  }

  const expectedChallenge = consumeChallenge('login', username);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Login expired. Please try again.' }, { status: 400 });
  }

  const user = userDB.findByUsername(username);
  const authenticator = authenticatorDB.findByCredentialId(credentialId);
  if (!user || !authenticator || authenticator.user_id !== user.id) {
    return NextResponse.json({ error: 'Authenticator not recognized' }, { status: 401 });
  }

  const { rpID, origin } = getRelyingParty(request);
  let verification;
  try {
    // Rejects a counter that didn't increase (cloned authenticator), unless both are 0.
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: authenticator.credential_id,
        publicKey: new Uint8Array(authenticator.credential_public_key),
        counter: authenticator.counter ?? 0,
        transports: parseTransports(authenticator.transports),
      },
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ error: 'Passkey verification failed' }, { status: 401 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: 'Passkey verification failed' }, { status: 401 });
  }

  authenticatorDB.updateCounter(authenticator.id, verification.authenticationInfo.newCounter ?? 0);
  await createSession(user);
  return NextResponse.json({ verified: true, username: user.username });
}
