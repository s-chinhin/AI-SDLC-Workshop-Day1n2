// Pure todo logic shared by API routes, the client, and unit tests.
// Must not import lib/db.ts (only its types).
import type { Todo } from './db';
import { RECURRENCE_PATTERNS, isReminderMinutes, type Priority, type RecurrencePattern } from './constants';
import { fromSingaporeParts, getSingaporeNow, getSingaporeParts, parseDate, toSingaporeISO } from './timezone';

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** Undefined/null → 'medium'; anything other than the exact lowercase enum throws. */
export function validatePriority(value: unknown): Priority {
  if (value === undefined || value === null) return 'medium';
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  throw new Error(`Invalid priority: ${String(value)}. Must be 'high', 'medium', or 'low'.`);
}

export function sortTodos<T extends Todo>(todos: T[]): T[] {
  return [...todos].sort((a, b) => {
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) {
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    }
    const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function sectionTodos<T extends Todo>(todos: T[], now: Date) {
  const incomplete = todos.filter((t) => !t.completed);
  const overdue = sortTodos(incomplete.filter((t) => t.due_date && new Date(t.due_date) < now));
  const pending = sortTodos(incomplete.filter((t) => !t.due_date || new Date(t.due_date) >= now));
  const completed = todos
    .filter((t) => t.completed)
    .sort(
      (a, b) =>
        new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
    );
  return { overdue, pending, completed };
}

/** Returns the trimmed title, or null if it is empty/whitespace/not a string. */
export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title ? title : null;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export function isRecurrencePattern(value: unknown): value is RecurrencePattern {
  return (RECURRENCE_PATTERNS as readonly unknown[]).includes(value);
}

/**
 * Validates the recurrence fields of a todo's final state. Recurring todos need a valid
 * pattern and a due date to anchor the next occurrence; non-recurring ones store no pattern.
 */
export function validateRecurrence(
  isRecurring: unknown,
  pattern: unknown,
  dueDate: string | null
): { is_recurring: boolean; recurrence_pattern: RecurrencePattern | null } | { error: string } {
  if (isRecurring === undefined || isRecurring === null || isRecurring === false) {
    return { is_recurring: false, recurrence_pattern: null };
  }
  if (isRecurring !== true) return { error: 'is_recurring must be a boolean' };
  if (!isRecurrencePattern(pattern)) {
    return { error: "Recurring todos need a recurrence_pattern of 'daily', 'weekly', 'monthly' or 'yearly'" };
  }
  if (!dueDate) return { error: 'Recurring todos require a due date' };
  return { is_recurring: true, recurrence_pattern: pattern };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12
}

/**
 * Next occurrence in Singapore wall-clock time, preserving time of day.
 * Monthly/yearly clamp to the last valid day (Jan 31 → Feb 28/29, Feb 29 → Feb 28)
 * rather than overflowing into the following month like Date#setMonth does.
 */
export function calculateNextDueDate(currentDueDate: string, pattern: RecurrencePattern): string {
  const p = getSingaporeParts(new Date(currentDueDate));
  let year = p.year;
  let month = p.month;
  let day = p.day;

  switch (pattern) {
    case 'daily':
      day += 1; // fromSingaporeParts rolls day overflow into the next month/year
      break;
    case 'weekly':
      day += 7;
      break;
    case 'monthly':
      year = month === 12 ? year + 1 : year;
      month = month === 12 ? 1 : month + 1;
      day = Math.min(day, daysInMonth(year, month));
      break;
    case 'yearly':
      year += 1;
      day = Math.min(day, daysInMonth(year, month));
      break;
  }
  return toSingaporeISO(fromSingaporeParts(year, month, day, p.hour, p.minute, p.second));
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Parses an optional `tag_ids` field: undefined stays undefined, otherwise an array of positive integers. */
export function parseTagIds(value: unknown): number[] | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v) && v > 0)) {
    return { error: 'tag_ids must be an array of tag ids' };
  }
  return [...new Set(value as number[])];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateSubtask {
  title: string;
  position: number;
}

export function serializeTemplateSubtasks(subtasks: TemplateSubtask[]): string | null {
  return subtasks.length ? JSON.stringify(subtasks.map(({ title, position }) => ({ title, position }))) : null;
}

/** Never throws: corrupted JSON yields no subtasks rather than failing the whole "use". */
export function parseTemplateSubtasks(json: string | null | undefined): TemplateSubtask[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.title === 'string' && s.title.trim())
      .map((s, i) => ({ title: s.title.trim(), position: Number.isInteger(s.position) ? s.position : i + 1 }))
      .sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}

export interface ValidTemplate {
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
}

const optionalText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Validates a template body. Recurrence and reminders need a due date, so for templates they
 * need a due-date offset (enforced at save time rather than failing later at use time).
 */
export function validateTemplateInput(body: Record<string, unknown>): ValidTemplate | { error: string } {
  const name = normalizeTitle(body.name);
  if (!name) return { error: 'Template name is required' };
  const title = normalizeTitle(body.title_template);
  if (!title) return { error: 'Todo title is required' };

  let priority: Priority;
  try {
    priority = validatePriority(body.priority);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const offset = body.due_date_offset_minutes ?? null;
  if (offset !== null && (!Number.isInteger(offset) || (offset as number) < 1)) {
    return { error: 'due_date_offset_minutes must be a whole number of minutes, at least 1' };
  }
  // Any placeholder date works: we only need to know whether a due date will exist.
  const dueAnchor = offset === null ? null : 'offset';
  const recurrence = validateRecurrence(body.is_recurring, body.recurrence_pattern, dueAnchor);
  if ('error' in recurrence) {
    return recurrence.error === 'Recurring todos require a due date'
      ? { error: 'Recurring templates need a due date offset' }
      : recurrence;
  }
  const reminder = validateReminder(body.reminder_minutes, dueAnchor);
  if ('error' in reminder) {
    return reminder.error === 'Reminders require a due date' ? { error: 'Reminders need a due date offset' } : reminder;
  }

  const rawSubtasks = body.subtasks ?? [];
  if (!Array.isArray(rawSubtasks)) return { error: 'subtasks must be an array' };
  const subtasks: TemplateSubtask[] = [];
  for (const s of rawSubtasks) {
    const t = normalizeTitle(typeof s === 'string' ? s : (s as { title?: unknown })?.title);
    if (!t) return { error: 'Subtask titles cannot be empty' };
    subtasks.push({ title: t, position: subtasks.length + 1 });
  }

  return {
    name,
    description: optionalText(body.description),
    category: optionalText(body.category),
    title_template: title,
    priority,
    ...recurrence,
    ...reminder,
    due_date_offset_minutes: offset as number | null,
    subtasks_json: serializeTemplateSubtasks(subtasks),
  };
}

/** Due date for a todo created from a template right now; null when the template has no offset. */
export function resolveTemplateDueDate(offsetMinutes: number | null, now: Date = getSingaporeNow()): string | null {
  if (offsetMinutes == null) return null;
  return toSingaporeISO(new Date(now.getTime() + offsetMinutes * 60_000));
}

// ---------------------------------------------------------------------------
// Subtask progress
// ---------------------------------------------------------------------------

export function calculateProgress(subtasks: { completed: boolean }[] = []) {
  const total = subtasks.length;
  const completed = subtasks.filter((s) => s.completed).length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** Reminders need one of the 7 presets (or null) and a due date to count back from. */
export function validateReminder(value: unknown, dueDate: string | null): { reminder_minutes: number | null } | { error: string } {
  if (value === undefined || value === null) return { reminder_minutes: null };
  if (!isReminderMinutes(value)) {
    return { error: 'reminder_minutes must be one of 15, 30, 60, 120, 1440, 2880, 10080' };
  }
  if (!dueDate) return { error: 'Reminders require a due date' };
  return { reminder_minutes: value };
}

/** Reminders whose window opened more than this long after the due date are skipped as stale. */
export const REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;

/** True when `now` is inside [due − reminder, due + grace] and nothing was sent for this window yet. */
export function isReminderDue(todo: Todo, now: Date): boolean {
  if (todo.completed || !todo.due_date || todo.reminder_minutes == null || todo.last_notification_sent) return false;
  const due = new Date(todo.due_date).getTime();
  const opens = due - todo.reminder_minutes * 60_000;
  return now.getTime() >= opens && now.getTime() <= due + REMINDER_GRACE_MS;
}

export const MIN_DUE_LEAD_MS = 60_000;

/** Validates a new due date: must parse and be at least 1 minute after `now`. Returns an error message or null. */
export function validateDueDate(value: unknown, now: Date = getSingaporeNow()): string | null {
  const due = parseDate(value);
  if (!due) return 'Invalid due date';
  if (due.getTime() < now.getTime() + MIN_DUE_LEAD_MS) {
    return 'Due date must be at least 1 minute in the future';
  }
  return null;
}
