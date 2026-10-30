import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { PRIORITIES, tagDB, todoDB, type Priority } from '@/lib/db';
import {
  normalizeTitle,
  parseTagIds,
  validateDueDate,
  validatePriority,
  validateRecurrence,
  validateReminder,
} from '@/lib/todoLogic';
import { getSingaporeNow, parseDate, toSingaporeISO } from '@/lib/timezone';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = normalizeTitle(body.title);
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  let dueDate: string | null = null;
  if (body.due_date) {
    const error = validateDueDate(body.due_date, getSingaporeNow());
    if (error) return NextResponse.json({ error }, { status: 400 });
    dueDate = toSingaporeISO(parseDate(body.due_date)!);
  }

  let priority: Priority;
  try {
    priority = validatePriority(body.priority);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const recurrence = validateRecurrence(body.is_recurring, body.recurrence_pattern, dueDate);
  if ('error' in recurrence) return NextResponse.json({ error: recurrence.error }, { status: 400 });

  const reminder = validateReminder(body.reminder_minutes, dueDate);
  if ('error' in reminder) return NextResponse.json({ error: reminder.error }, { status: 400 });

  const tagIds = parseTagIds(body.tag_ids);
  if (tagIds && 'error' in tagIds) return NextResponse.json({ error: tagIds.error }, { status: 400 });
  if (tagIds && !tagDB.allOwned(tagIds, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  const todo = todoDB.create({
    user_id: session.userId,
    title,
    due_date: dueDate,
    priority,
    ...recurrence,
    ...reminder,
  });
  if (tagIds?.length) tagDB.setTodoTags(todo.id, tagIds);

  return NextResponse.json(todoDB.findById(todo.id), { status: 201 });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  let todos = todoDB.findAllByUser(session.userId);
  // Optional ?priority= filter for direct API consumers; the UI filters client-side.
  const priority = request.nextUrl.searchParams.get('priority');
  if (priority) {
    if (!(PRIORITIES as readonly string[]).includes(priority)) {
      return NextResponse.json({ error: `Invalid priority: ${priority}` }, { status: 400 });
    }
    todos = todos.filter((t) => t.priority === priority);
  }
  return NextResponse.json(todos);
}
