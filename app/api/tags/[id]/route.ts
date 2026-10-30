import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { DuplicateTagError, tagDB } from '@/lib/db';
import { HEX_COLOR } from '@/lib/todoLogic';

type Params = { params: Promise<{ id: string }> };

async function loadOwnedTag(params: Params['params']) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const { id } = await params;
  const tag = tagDB.findById(Number(id), session.userId);
  if (!tag) {
    return { error: NextResponse.json({ error: 'Tag not found' }, { status: 404 }) };
  }
  return { session, tag };
}

export async function PUT(request: NextRequest, { params }: Params) {
  const result = await loadOwnedTag(params);
  if (result.error) return result.error;

  const body = await request.json().catch(() => ({}));
  const update: { name?: string; color?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    update.name = name;
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !HEX_COLOR.test(body.color)) {
      return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 });
    }
    update.color = body.color;
  }

  try {
    return NextResponse.json(tagDB.update(result.tag.id, result.session.userId, update));
  } catch (err) {
    if (err instanceof DuplicateTagError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await loadOwnedTag(params);
  if (result.error) return result.error;
  tagDB.delete(result.tag.id, result.session.userId); // CASCADE removes todo_tags rows
  return NextResponse.json({ success: true });
}
