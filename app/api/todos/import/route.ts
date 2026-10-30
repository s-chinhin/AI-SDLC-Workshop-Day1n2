import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { importTodos } from '@/lib/db';
import { IMPORT_FORMAT_ERROR, importSchema } from '@/lib/exportImport';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
  }

  // Validate the whole document first; nothing is written unless all of it is valid.
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: IMPORT_FORMAT_ERROR }, { status: 400 });
  }

  const result = importTodos(session.userId, parsed.data.todos);
  return NextResponse.json({ success: true, ...result });
}
