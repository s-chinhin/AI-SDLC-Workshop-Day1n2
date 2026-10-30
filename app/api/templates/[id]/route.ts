import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { parseTemplateSubtasks, validateTemplateInput } from '@/lib/todoLogic';

type Params = { params: Promise<{ id: string }> };

async function loadOwnedTemplate(params: Params['params']) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const { id } = await params;
  const template = templateDB.findById(Number(id), session.userId);
  if (!template) {
    return { error: NextResponse.json({ error: 'Template not found' }, { status: 404 }) };
  }
  return { session, template };
}

/** Full replace: missing optional fields are cleared. Subtasks default to the current ones. */
export async function PUT(request: NextRequest, { params }: Params) {
  const result = await loadOwnedTemplate(params);
  if (result.error) return result.error;
  const body = await request.json().catch(() => ({}));
  const input = validateTemplateInput({
    subtasks: parseTemplateSubtasks(result.template.subtasks_json),
    ...body,
  });
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const updated = templateDB.update(result.template.id, result.session.userId, input)!;
  return NextResponse.json({ ...updated, subtasks: parseTemplateSubtasks(updated.subtasks_json) });
}

/** Todos already created from this template are untouched (no FK from todos to templates). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const result = await loadOwnedTemplate(params);
  if (result.error) return result.error;
  templateDB.delete(result.template.id, result.session.userId);
  return NextResponse.json({ success: true });
}
