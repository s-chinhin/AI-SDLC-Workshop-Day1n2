import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createTodoWithSubtasks, templateDB } from '@/lib/db';
import { parseTemplateSubtasks, resolveTemplateDueDate } from '@/lib/todoLogic';
import { getSingaporeNow } from '@/lib/timezone';

// Creates a todo (+ unchecked subtasks) from the template. No tags are applied; the due
// date, if any, is "now in Singapore + offset".
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { id } = await params;
  const template = templateDB.findById(Number(id), session.userId);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const dueDate = resolveTemplateDueDate(template.due_date_offset_minutes, getSingaporeNow());
  const todo = createTodoWithSubtasks(
    {
      user_id: session.userId,
      title: template.title_template,
      priority: template.priority,
      due_date: dueDate,
      // Guard old rows that predate the save-time invariant: no due date → no recurrence/reminder.
      is_recurring: dueDate ? template.is_recurring : false,
      recurrence_pattern: dueDate ? template.recurrence_pattern : null,
      reminder_minutes: dueDate ? (template.reminder_minutes ?? null) : null,
    },
    parseTemplateSubtasks(template.subtasks_json)
  );
  return NextResponse.json(todo, { status: 201 });
}
