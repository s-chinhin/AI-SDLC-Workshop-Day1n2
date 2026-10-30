import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { DEFAULT_TAG_COLOR, DuplicateTagError, tagDB } from '@/lib/db';
import { HEX_COLOR } from '@/lib/todoLogic';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(tagDB.findAllByUser(session.userId));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }
  const color = body.color ?? DEFAULT_TAG_COLOR;
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 });
  }

  try {
    return NextResponse.json(tagDB.create(session.userId, { name, color }), { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateTagError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
