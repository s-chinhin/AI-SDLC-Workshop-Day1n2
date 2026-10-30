// Export/import formats. JSON round-trips (minus original IDs); CSV is one-way.
import { z } from 'zod';
import type { Todo } from './db';
import { PRIORITIES, RECURRENCE_PATTERNS, REMINDER_OPTIONS } from './constants';

export interface TodoExportItem {
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Todo['priority'];
  is_recurring: boolean;
  recurrence_pattern: Todo['recurrence_pattern'];
  reminder_minutes: number | null;
  created_at: string;
  subtasks: { title: string; completed: boolean; position: number }[];
  tags: { name: string; color: string }[];
}

export interface TodoExport {
  version: 1;
  exported_at: string;
  todos: TodoExportItem[];
}

export interface ImportResult {
  imported: number;
  tagsCreated: number;
  tagsReused: number;
}

export const IMPORT_FORMAT_ERROR = 'Failed to import todos. Please check the file format.';

export function toExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({ title, completed, position })),
    tags: (todo.tags ?? []).map(({ name, color }) => ({ name, color })),
  };
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'];

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(todos: Todo[]): string {
  const rows = todos.map((t) =>
    [
      t.id,
      t.title,
      t.completed ? 'Yes' : 'No',
      t.due_date ?? '',
      t.priority,
      t.is_recurring ? 'Yes' : 'No',
      t.recurrence_pattern ?? '',
      t.reminder_minutes ?? '',
    ]
      .map(csvEscape)
      .join(',')
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Import validation: the whole document is checked before anything is written.
// ---------------------------------------------------------------------------

const isoDate = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid date');

const importItem = z
  .object({
    title: z.string().trim().min(1),
    completed: z.boolean(),
    due_date: isoDate.nullable(),
    priority: z.enum(PRIORITIES as [string, ...string[]]),
    is_recurring: z.boolean(),
    recurrence_pattern: z.enum(RECURRENCE_PATTERNS as [string, ...string[]]).nullable(),
    reminder_minutes: z
      .number()
      .int()
      .refine((n) => (REMINDER_OPTIONS as readonly number[]).includes(n))
      .nullable(),
    created_at: z.string(),
    subtasks: z.array(z.object({ title: z.string().trim().min(1), completed: z.boolean(), position: z.number().int() })),
    tags: z.array(z.object({ name: z.string().trim().min(1), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) })),
  })
  // Same invariants the API enforces: recurrence needs a pattern and a due date; reminders need a due date.
  .refine((t) => !t.is_recurring || (t.recurrence_pattern !== null && t.due_date !== null))
  .refine((t) => t.reminder_minutes === null || t.due_date !== null);

export const importSchema = z.object({
  version: z.literal(1),
  exported_at: z.string(),
  todos: z.array(importItem),
});

export type ImportItem = z.infer<typeof importItem>;
