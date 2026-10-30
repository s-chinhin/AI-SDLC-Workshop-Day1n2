import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB, type UpdateTodoInput } from '@/lib/db';
import {
  calculateNextDueDate,
  normalizeTitle,
  parseTagIds,
  validateDueDate,
  validatePriority,
  validateRecurrence,
  validateReminder,
} from '@/lib/todoLogic';
import { getSingaporeNow, parseDate, toSingaporeISO } from '@/lib/timezone';

type Params = { params: Promise<{ id: string }> };

async function loadOwnedTodo(params: Params['params']) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const { id } = await params;
  const todo = todoDB.findById(Number(id));
  // 404 (not 403) so other users' todo IDs aren't revealed.
  if (!todo || todo.user_id !== session.userId) {
    return { error: NextResponse.json({ error: 'Todo not found' }, { status: 404 }) };
  }
  return { session, todo };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const result = await loadOwnedTodo(params);
  if (result.error) return result.error;
  return NextResponse.json(result.todo);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const result = await loadOwnedTodo(params);
  if (result.error) return result.error;
  const existing = result.todo;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: UpdateTodoInput = {};

  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    update.title = title;
  }

  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') {
      return NextResponse.json({ error: 'completed must be a boolean' }, { status: 400 });
    }
    update.completed = body.completed;
  }

  if (body.priority !== undefined) {
    // null can't clear a NOT NULL column, so on update it is rejected like any other bad value.
    if (body.priority === null) {
      return NextResponse.json({ error: "Invalid priority: null. Must be 'high', 'medium', or 'low'." }, { status: 400 });
    }
    try {
      update.priority = validatePriority(body.priority);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  if (body.due_date !== undefined) {
    if (body.due_date === null || body.due_date === '') {
      update.due_date = null;
    } else {
      const parsed = parseDate(body.due_date);
      if (!parsed) return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
      const normalized = toSingaporeISO(parsed);
      // Only a changed due date has to be in the future; re-saving an overdue todo is fine.
      if (normalized !== existing.due_date) {
        const error = validateDueDate(normalized, getSingaporeNow());
        if (error) return NextResponse.json({ error }, { status: 400 });
      }
      update.due_date = normalized;
    }
  }

  // Validate recurrence against the todo's resulting state whenever any input to it changes.
  if (body.is_recurring !== undefined || body.recurrence_pattern !== undefined || update.due_date !== undefined) {
    const recurrence = validateRecurrence(
      body.is_recurring !== undefined ? body.is_recurring : existing.is_recurring,
      body.recurrence_pattern !== undefined ? body.recurrence_pattern : existing.recurrence_pattern,
      update.due_date !== undefined ? update.due_date : existing.due_date
    );
    if ('error' in recurrence) return NextResponse.json({ error: recurrence.error }, { status: 400 });
    Object.assign(update, recurrence);
  }

  if (body.reminder_minutes !== undefined || update.due_date !== undefined) {
    const finalDue = update.due_date !== undefined ? update.due_date : existing.due_date;
    // Clearing the due date also clears its reminder rather than failing.
    const requested = body.reminder_minutes !== undefined ? body.reminder_minutes : finalDue ? existing.reminder_minutes : null;
    const reminder = validateReminder(requested, finalDue);
    if ('error' in reminder) return NextResponse.json({ error: reminder.error }, { status: 400 });
    update.reminder_minutes = reminder.reminder_minutes;
  }

  // A moved deadline or new reminder timing re-arms the reminder.
  const dueChanged = update.due_date !== undefined && update.due_date !== existing.due_date;
  const reminderChanged = update.reminder_minutes !== undefined && update.reminder_minutes !== existing.reminder_minutes;
  if (dueChanged || reminderChanged) {
    update.last_notification_sent = null;
  } else if (body.last_notification_sent !== undefined) {
    // Set by the client after it shows a notification.
    if (body.last_notification_sent !== null && !parseDate(body.last_notification_sent)) {
      return NextResponse.json({ error: 'Invalid last_notification_sent' }, { status: 400 });
    }
    update.last_notification_sent =
      body.last_notification_sent === null ? null : toSingaporeISO(parseDate(body.last_notification_sent)!);
  }

  // `tag_ids` replaces the todo's whole tag set (used by the edit modal).
  const tagIds = parseTagIds(body.tag_ids);
  if (tagIds && 'error' in tagIds) return NextResponse.json({ error: tagIds.error }, { status: 400 });
  if (tagIds && !tagDB.allOwned(tagIds, result.session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }
  if (tagIds) tagDB.setTodoTags(existing.id, tagIds);

  // Completing a recurring todo spawns the next instance, using the values in effect now.
  const { completed, ...otherChanges } = update;
  const afterEdit = Object.keys(otherChanges).length ? todoDB.update(existing.id, otherChanges)! : existing;
  if (completed === true && !existing.completed && afterEdit.is_recurring && afterEdit.recurrence_pattern && afterEdit.due_date) {
    const nextDue = calculateNextDueDate(afterEdit.due_date, afterEdit.recurrence_pattern);
    const { todo, nextInstance } = todoDB.completeRecurring(existing.id, nextDue);
    return NextResponse.json({ ...todo, next_instance: nextInstance });
  }

  if (completed !== undefined) todoDB.update(existing.id, { completed });
  return NextResponse.json(todoDB.findById(existing.id));
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await loadOwnedTodo(params);
  if (result.error) return result.error;
  todoDB.delete(result.todo.id); // FK CASCADE removes subtasks + todo_tags rows
  return NextResponse.json({ success: true });
}
