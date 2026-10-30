import { test, expect } from '@playwright/test';
import type { Todo } from '../../lib/db';
import {
  calculateNextDueDate,
  calculateProgress,
  parseTemplateSubtasks,
  resolveTemplateDueDate,
  serializeTemplateSubtasks,
  validateTemplateInput,
  normalizeTitle,
  sectionTodos,
  sortTodos,
  validateDueDate,
  validatePriority,
  validateRecurrence,
} from '../../lib/todoLogic';
import type { RecurrencePattern } from '../../lib/constants';
import { csvEscape } from '../../lib/exportImport';
import { datetimeLocalToISO, isoToDatetimeLocal, toSingaporeISO } from '../../lib/timezone';

function todo(partial: Partial<Todo>): Todo {
  return {
    id: 1,
    user_id: 1,
    title: 't',
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    ...partial,
  };
}

test.describe('sortTodos', () => {
  test('orders by priority, then due date, then newest created', () => {
    const list = [
      todo({ id: 1, priority: 'low', due_date: '2026-01-01T10:00:00+08:00' }),
      todo({ id: 2, priority: 'high', due_date: null }),
      todo({ id: 3, priority: 'high', due_date: '2026-01-02T10:00:00+08:00' }),
      todo({ id: 4, priority: 'medium', created_at: '2026-01-01T00:00:00Z' }),
      todo({ id: 5, priority: 'medium', created_at: '2026-01-02T00:00:00Z' }),
    ];
    expect(sortTodos(list).map((t) => t.id)).toEqual([3, 2, 5, 4, 1]);
  });
});

test.describe('sectionTodos', () => {
  const now = new Date('2026-06-01T12:00:00+08:00');

  test('due exactly now is pending; one ms earlier is overdue', () => {
    const { overdue, pending } = sectionTodos(
      [
        todo({ id: 1, due_date: '2026-06-01T12:00:00+08:00' }),
        todo({ id: 2, due_date: '2026-06-01T11:59:59.999+08:00' }),
      ],
      now
    );
    expect(pending.map((t) => t.id)).toEqual([1]);
    expect(overdue.map((t) => t.id)).toEqual([2]);
  });

  test('no due date is always pending; completed goes to completed', () => {
    const s = sectionTodos(
      [todo({ id: 1 }), todo({ id: 2, completed: true, due_date: '2020-01-01T00:00:00+08:00' })],
      now
    );
    expect(s.pending.map((t) => t.id)).toEqual([1]);
    expect(s.completed.map((t) => t.id)).toEqual([2]);
    expect(s.overdue).toEqual([]);
  });
});

test.describe('validateDueDate', () => {
  const now = new Date('2026-06-01T12:00:00+08:00');
  test('rejects < 1 minute ahead, accepts >= 1 minute', () => {
    expect(validateDueDate('2026-06-01T12:00:59+08:00', now)).not.toBeNull();
    expect(validateDueDate('2026-06-01T12:01:00+08:00', now)).toBeNull();
    expect(validateDueDate('2026-06-01T11:00:00+08:00', now)).not.toBeNull();
  });
  test('rejects malformed input', () => {
    expect(validateDueDate('not a date', now)).toBe('Invalid due date');
  });
});

test.describe('normalizeTitle', () => {
  test('trims and rejects blank titles', () => {
    expect(normalizeTitle('  Buy milk ')).toBe('Buy milk');
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle(42)).toBeNull();
  });
});

test.describe('timezone helpers', () => {
  test('datetime-local round trips as Singapore time', () => {
    const iso = datetimeLocalToISO('2026-03-04T09:05');
    expect(iso).toBe('2026-03-04T09:05:00+08:00');
    expect(new Date(iso!).toISOString()).toBe('2026-03-04T01:05:00.000Z');
    expect(isoToDatetimeLocal(iso)).toBe('2026-03-04T09:05');
  });
  test('toSingaporeISO converts UTC instants', () => {
    expect(toSingaporeISO(new Date('2026-12-31T20:30:00Z'))).toBe('2027-01-01T04:30:00+08:00');
  });
});

test.describe('validatePriority', () => {
  test('accepts the enum, defaults null/undefined, throws otherwise', () => {
    expect(validatePriority('high')).toBe('high');
    expect(validatePriority('low')).toBe('low');
    expect(validatePriority(undefined)).toBe('medium');
    expect(validatePriority(null)).toBe('medium');
    for (const bad of ['HIGH', 'urgent', '', 1]) expect(() => validatePriority(bad)).toThrow(/Invalid priority/);
  });

  test('sortTodos does not mutate its input and ties break on newest created', () => {
    const input = [
      todo({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      todo({ id: 2, created_at: '2026-01-03T00:00:00Z' }),
    ];
    const snapshot = input.map((t) => t.id);
    expect(sortTodos(input).map((t) => t.id)).toEqual([2, 1]);
    expect(input.map((t) => t.id)).toEqual(snapshot);
  });
});

test.describe('calculateNextDueDate', () => {
  const cases: [string, RecurrencePattern, string][] = [
    ['2025-11-10T14:00:00+08:00', 'daily', '2025-11-11T14:00:00+08:00'],
    ['2025-11-10T14:00:00+08:00', 'weekly', '2025-11-17T14:00:00+08:00'],
    ['2025-06-15T09:00:00+08:00', 'monthly', '2025-07-15T09:00:00+08:00'],
    ['2025-01-31T09:00:00+08:00', 'monthly', '2025-02-28T09:00:00+08:00'],
    ['2024-01-31T09:00:00+08:00', 'monthly', '2024-02-29T09:00:00+08:00'],
    ['2025-12-31T09:00:00+08:00', 'monthly', '2026-01-31T09:00:00+08:00'],
    ['2025-06-15T09:00:00+08:00', 'yearly', '2026-06-15T09:00:00+08:00'],
    ['2024-02-29T09:00:00+08:00', 'yearly', '2025-02-28T09:00:00+08:00'],
    ['2025-12-31T23:30:00+08:00', 'daily', '2026-01-01T23:30:00+08:00'],
    // Stored as UTC, still computed on the Singapore calendar day (Jan 31 SGT).
    ['2025-01-30T17:00:00.000Z', 'monthly', '2025-02-28T01:00:00+08:00'],
  ];
  for (const [from, pattern, to] of cases) {
    test(`${pattern}: ${from} → ${to}`, () => {
      expect(calculateNextDueDate(from, pattern)).toBe(to);
    });
  }
});

test.describe('validateRecurrence', () => {
  test('requires a valid pattern and a due date when recurring', () => {
    expect(validateRecurrence(undefined, 'daily', null)).toEqual({ is_recurring: false, recurrence_pattern: null });
    expect(validateRecurrence(true, 'daily', '2026-01-01T00:00:00+08:00')).toEqual({ is_recurring: true, recurrence_pattern: 'daily' });
    expect(validateRecurrence(true, 'hourly', '2026-01-01T00:00:00+08:00')).toHaveProperty('error');
    expect(validateRecurrence(true, 'daily', null)).toEqual({ error: 'Recurring todos require a due date' });
    expect(validateRecurrence('yes', 'daily', 'x')).toHaveProperty('error');
  });
});

test.describe('calculateProgress', () => {
  test('counts completed over total and rounds the percent', () => {
    expect(calculateProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(calculateProgress([{ completed: true }, { completed: false }, { completed: false }])).toEqual({ completed: 1, total: 3, percent: 33 });
    expect(calculateProgress([{ completed: true }, { completed: true }])).toEqual({ completed: 2, total: 2, percent: 100 });
  });
});

test.describe('template helpers', () => {
  test('subtasks_json round-trips and malformed JSON falls back to []', () => {
    const subs = [
      { title: 'One', position: 1 },
      { title: 'Two', position: 2 },
    ];
    expect(parseTemplateSubtasks(serializeTemplateSubtasks(subs))).toEqual(subs);
    expect(serializeTemplateSubtasks([])).toBeNull();
    expect(parseTemplateSubtasks(null)).toEqual([]);
    expect(parseTemplateSubtasks('{not json')).toEqual([]);
    expect(parseTemplateSubtasks('{"title":"x"}')).toEqual([]);
  });

  test('due date offset is exact to the minute in Singapore time', () => {
    const now = new Date('2026-03-01T23:30:00+08:00');
    expect(resolveTemplateDueDate(90, now)).toBe('2026-03-02T01:00:00+08:00');
    expect(resolveTemplateDueDate(null, now)).toBeNull();
  });

  test('validateTemplateInput rejects recurring without an offset', () => {
    expect(validateTemplateInput({ name: 'n', title_template: 't', is_recurring: true, recurrence_pattern: 'daily' })).toEqual({
      error: 'Recurring templates need a due date offset',
    });
    const ok = validateTemplateInput({
      name: ' n ',
      title_template: 't',
      is_recurring: true,
      recurrence_pattern: 'daily',
      due_date_offset_minutes: 60,
      subtasks: ['a', { title: 'b' }],
    });
    expect(ok).toMatchObject({ name: 'n', is_recurring: true, subtasks_json: '[{"title":"a","position":1},{"title":"b","position":2}]' });
  });
});

test.describe('CSV escaping', () => {
  test('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
  });
});
