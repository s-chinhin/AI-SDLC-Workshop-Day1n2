import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getSession } from '@/lib/auth';
import { authenticatorDB, userDB } from '@/lib/db';
import { RP_NAME, getRelyingParty, normalizeUsername, parseTransports, storeChallenge } from '@/lib/webauthn';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  if (!username) {
    return NextResponse.json(
      { error: 'Username must be 3–64 characters: letters, numbers, dot, dash or underscore' },
      { status: 400 }
    );
  }

  // An existing username is only allowed when its signed-in owner is adding another device.
  const existing = userDB.findByUsername(username);
  if (existing) {
    const session = await getSession();
    if (session?.userId !== existing.id) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
  }

  const { rpID } = getRelyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: username,
    attestationType: 'none',
    excludeCredentials: existing
      ? authenticatorDB.findByUserId(existing.id).map((a) => ({
          id: a.credential_id,
          transports: parseTransports(a.transports),
        }))
      : [],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  storeChallenge('register', username, options.challenge);
  return NextResponse.json(options);
}
