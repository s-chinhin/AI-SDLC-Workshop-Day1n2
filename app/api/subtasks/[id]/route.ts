import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB } from '@/lib/db';
import { normalizeTitle } from '@/lib/todoLogic';

type Params = { params: Promise<{ id: string }> };

/** Ownership is checked through subtask → todo → user; other users get 404. */
async function loadOwnedSubtask(params: Params['params']) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const { id } = await params;
  const subtask = subtaskDB.findOwned(Number(id), session.userId);
  if (!subtask) {
    return { error: NextResponse.json({ error: 'Subtask not found' }, { status: 404 }) };
  }
  return { subtask };
}

export async function PUT(request: NextRequest, { params }: Params) {
  const result = await loadOwnedSubtask(params);
  if (result.error) return result.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const update: { title?: string; completed?: boolean } = {};
  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
    update.title = title;
  }
  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') {
      return NextResponse.json({ error: 'completed must be a boolean' }, { status: 400 });
    }
    update.completed = body.completed;
  }

  return NextResponse.json(subtaskDB.update(result.subtask.id, update));
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await loadOwnedSubtask(params);
  if (result.error) return result.error;
  subtaskDB.delete(result.subtask.id);
  return NextResponse.json({ success: true });
}
