import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

/** Resolves the session, the owned todo, and an owned tag from `{ tag_id }`; 404 on any cross-user id. */
async function resolve(request: NextRequest, params: Params['params']) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const { id } = await params;
  const todo = todoDB.findById(Number(id));
  if (!todo || todo.user_id !== session.userId) {
    return { error: NextResponse.json({ error: 'Todo not found' }, { status: 404 }) };
  }
  const body = await request.json().catch(() => ({}));
  const tag = Number.isInteger(body.tag_id) ? tagDB.findById(body.tag_id, session.userId) : undefined;
  if (!tag) {
    return { error: NextResponse.json({ error: 'Tag not found' }, { status: 404 }) };
  }
  return { todo, tag };
}

export async function POST(request: NextRequest, { params }: Params) {
  const result = await resolve(request, params);
  if (result.error) return result.error;
  tagDB.attachToTodo(result.todo.id, result.tag.id); // no-op if already attached
  return NextResponse.json(todoDB.findById(result.todo.id));
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const result = await resolve(request, params);
  if (result.error) return result.error;
  tagDB.detachFromTodo(result.todo.id, result.tag.id); // no-op if not attached
  return NextResponse.json(todoDB.findById(result.todo.id));
}
