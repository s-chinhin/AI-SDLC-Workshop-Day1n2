import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { toCsv, toExportItem, type TodoExport } from '@/lib/exportImport';
import { getSingaporeNow, toSingaporeDateKey, toSingaporeISO } from '@/lib/timezone';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: "format must be 'json' or 'csv'" }, { status: 400 });
  }

  const now = getSingaporeNow();
  const todos = todoDB.findAllByUser(session.userId); // includes subtasks + tags
  const filename = `todos-${toSingaporeDateKey(now)}.${format}`;
  const headers = { 'Content-Disposition': `attachment; filename="${filename}"` };

  if (format === 'csv') {
    return new NextResponse(toCsv(todos), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
  }

  const payload: TodoExport = { version: 1, exported_at: toSingaporeISO(now), todos: todos.map(toExportItem) };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
