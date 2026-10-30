// Enum values shared by server and client. Client code must import runtime
// values from here, never from lib/db.ts (which pulls in better-sqlite3).

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080; // 15m,30m,1h,2h,1d,2d,1w

export const DEFAULT_TAG_COLOR = '#3B82F6';

export const PRIORITIES:readonly Priority[] = ['high', 'medium', 'low'];
export const RECURRENCE_PATTERNS: readonly RecurrencePattern[] = ['daily', 'weekly', 'monthly', 'yearly'];
export const REMINDER_OPTIONS: readonly ReminderMinutes[] = [15, 30, 60, 120, 1440, 2880, 10080];

export const REMINDER_LABELS: Record<ReminderMinutes, string> = {
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  1440: '1d',
  2880: '2d',
  10080: '1w',
};

export function isReminderMinutes(value: unknown): value is ReminderMinutes {
  return (REMINDER_OPTIONS as readonly unknown[]).includes(value);
}
