import { test, expect } from '@playwright/test';
import type { Todo } from '../../lib/db';
import { DEFAULT_FILTER_STATE, applyFilters, describeFilters, hasActiveFilters } from '../../lib/filters';

const tag = (id: number, name: string) => ({ id, user_id: 1, name, color: '#3B82F6', created_at: '' });

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
    subtasks: [],
    tags: [],
    ...partial,
  };
}

const todos = [
  todo({ id: 1, title: 'Write report', priority: 'high', tags: [tag(1, 'Work')], due_date: '2026-11-03T10:00:00+08:00' }),
  todo({ id: 2, title: 'Buy milk', subtasks: [{ id: 1, todo_id: 2, title: 'Report receipts', completed: false, position: 1, created_at: '' }] }),
  todo({ id: 3, title: 'Report done', priority: 'high', completed: true, tags: [tag(1, 'Work')] }),
  // 23:30 UTC on Nov 4 is Nov 5 in Singapore.
  todo({ id: 4, title: 'Late night', due_date: '2026-11-04T23:30:00.000Z' }),
];
const ids = (list: Todo[]) => list.map((t) => t.id);

test.describe('applyFilters', () => {
  test('search covers subtasks; all dimensions AND together', () => {
    expect(ids(applyFilters(todos, { ...DEFAULT_FILTER_STATE, search: '  REPORT ' }))).toEqual([1, 2, 3]);
    expect(
      ids(applyFilters(todos, { ...DEFAULT_FILTER_STATE, search: 'report', priority: 'high', tagId: 1, completion: 'incomplete' }))
    ).toEqual([1]);
    expect(ids(applyFilters(todos, { ...DEFAULT_FILTER_STATE, completion: 'completed' }))).toEqual([3]);
  });

  test('date range uses the Singapore calendar day and skips undated todos', () => {
    expect(ids(applyFilters(todos, { ...DEFAULT_FILTER_STATE, dueDateFrom: '2026-11-05' }))).toEqual([4]);
    expect(ids(applyFilters(todos, { ...DEFAULT_FILTER_STATE, dueDateTo: '2026-11-04' }))).toEqual([1]);
  });

  test('1000 todos filter in under 100ms', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      todo({ id: i, title: `Task ${i}`, priority: (['high', 'medium', 'low'] as const)[i % 3], tags: [tag(i % 5, 't')] })
    );
    const start = performance.now();
    applyFilters(many, { ...DEFAULT_FILTER_STATE, search: 'task 9', priority: 'high', tagId: 2, completion: 'incomplete' });
    expect(performance.now() - start).toBeLessThan(100);
  });

  test('hasActiveFilters and describeFilters', () => {
    expect(hasActiveFilters(DEFAULT_FILTER_STATE)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, search: '   ' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTER_STATE, dueDateTo: '2026-01-01' })).toBe(true);
    expect(describeFilters({ ...DEFAULT_FILTER_STATE, priority: 'low', tagId: 1, dueDateFrom: '2026-01-01' }, [tag(1, 'Work')])).toBe(
      'Priority: Low · Tag: Work · Date: from 2026-01-01'
    );
  });
});
