import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB, type Template } from '@/lib/db';
import { parseTemplateSubtasks, validateTemplateInput } from '@/lib/todoLogic';

/** API shape: the stored row plus its subtasks already parsed for the UI. */
function withSubtasks(template: Template) {
  return { ...template, subtasks: parseTemplateSubtasks(template.subtasks_json) };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(templateDB.findAllByUser(session.userId).map(withSubtasks));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const input = validateTemplateInput(body);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  return NextResponse.json(withSubtasks(templateDB.create(session.userId, input)), { status: 201 });
}
