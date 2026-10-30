import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { isReminderDue } from '@/lib/todoLogic';
import { getSingaporeNow } from '@/lib/timezone';

// The client calls this right before showing a notification. Only the first caller for a
// reminder window gets `claimed: true`, so polls racing in one tab or across tabs can't
// show the same reminder twice.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const { id } = await params;
  const todo = todoDB.findById(Number(id));
  if (!todo || todo.user_id !== session.userId) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }
  const claimed = isReminderDue(todo, getSingaporeNow()) && todoDB.claimReminder(todo.id, session.userId);
  return NextResponse.json({ claimed });
}
