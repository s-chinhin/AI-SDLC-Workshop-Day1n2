import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createSession, getSession } from '@/lib/auth';
import { authenticatorDB, registerUserWithAuthenticator, userDB } from '@/lib/db';
import { consumeChallenge, getRelyingParty, normalizeUsername } from '@/lib/webauthn';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  if (!username || !body.response) {
    return NextResponse.json({ error: 'Invalid registration request' }, { status: 400 });
  }

  const expectedChallenge = consumeChallenge('register', username);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Registration expired. Please try again.' }, { status: 400 });
  }

  const { rpID, origin } = getRelyingParty(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ error: 'Passkey verification failed' }, { status: 400 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  if (authenticatorDB.findByCredentialId(credential.id)) {
    return NextResponse.json({ error: 'This passkey is already registered' }, { status: 409 });
  }
  const newAuthenticator = {
    credential_id: credential.id,
    credential_public_key: credential.publicKey,
    counter: credential.counter ?? 0,
    transports: credential.transports,
  };

  const existing = userDB.findByUsername(username);
  if (existing) {
    // Adding a second device: only the signed-in owner may do this.
    const session = await getSession();
    if (session?.userId !== existing.id) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
    authenticatorDB.create({ ...newAuthenticator, user_id: existing.id });
    return NextResponse.json({ verified: true, username: existing.username });
  }

  const user = registerUserWithAuthenticator(username, newAuthenticator);
  await createSession(user);
  return NextResponse.json({ verified: true, username: user.username });
}
