import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { isReminderDue } from '@/lib/todoLogic';
import { getSingaporeNow } from '@/lib/timezone';

// Returns todos whose reminder window is open and that haven't been notified yet.
// Timing is decided here on the server, so client clock skew can't fire early or late.
// Reminders more than 24h past their due date are skipped (see REMINDER_GRACE_MS).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const now = getSingaporeNow();
  const due = todoDB.findPendingReminders(session.userId).filter((t) => isReminderDue(t, now));
  return NextResponse.json({ success: true, data: due });
}
