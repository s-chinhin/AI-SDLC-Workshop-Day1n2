import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, todoDB } from '@/lib/db';
import { normalizeTitle } from '@/lib/todoLogic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params; // parent todo id
  const todo = todoDB.findById(Number(id));
  if (!todo || todo.user_id !== session.userId) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const title = normalizeTitle(body.title);
  if (!title) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }

  return NextResponse.json(subtaskDB.create(todo.id, title), { status: 201 });
}
