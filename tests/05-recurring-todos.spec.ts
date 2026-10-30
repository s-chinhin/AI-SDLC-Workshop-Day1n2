import { test, expect } from '@playwright/test';
import { TodoHelpers, isoFromNow, sgDatetimeLocal } from './helpers';

type TodoJSON = { id: number; title: string; due_date: string; completed: boolean; priority: string; is_recurring: boolean; recurrence_pattern: string | null };

test.describe('Recurring todos (PRP 03)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  const allTodos = async (): Promise<TodoJSON[]> => (await h.request.get('/api/todos')).json();

  test('create a daily recurring todo via the form → 🔄 daily badge', async ({ page }) => {
    await page.getByLabel('Todo title').fill('Standup');
    await page.getByLabel('Due date', { exact: true }).fill(sgDatetimeLocal(60));
    await page.getByLabel('Repeat', { exact: true }).check();
    await page.getByLabel('Recurrence pattern', { exact: true }).selectOption('daily');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(h.item('Standup').getByTestId('recurrence-badge')).toHaveText('🔄daily');
    await page.reload();
    await expect(h.item('Standup').getByTestId('recurrence-badge')).toContainText('daily');
  });

  test('recurring without a due date is blocked in the form and by the API', async ({ page }) => {
    await page.getByLabel('Todo title').fill('No anchor');
    await page.getByLabel('Repeat', { exact: true }).check();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Recurring todos require a due date');

    const res = await h.request.post('/api/todos', { data: { title: 'x', is_recurring: true, recurrence_pattern: 'daily' } });
    expect(res.status()).toBe(400);
    const bad = await h.request.post('/api/todos', {
      data: { title: 'x', is_recurring: true, recurrence_pattern: 'hourly', due_date: isoFromNow(60) },
    });
    expect(bad.status()).toBe(400);
    expect(await allTodos()).toHaveLength(0);
  });

  test('completing a weekly todo creates one new instance due +7 days with inherited fields', async ({ page }) => {
    const original = await h.apiCreateTodo({
      title: 'Weekly review',
      priority: 'high',
      due_date: isoFromNow(120),
      is_recurring: true,
      recurrence_pattern: 'weekly',
    });
    await page.reload();
    await h.section('pending').getByRole('checkbox', { name: 'Mark "Weekly review" as complete' }).click();

    await expect(h.section('completed').getByText('Weekly review')).toBeVisible();
    await expect(h.section('pending').getByText('Weekly review')).toBeVisible();

    const todos = await allTodos();
    expect(todos).toHaveLength(2);
    const next = todos.find((t) => t.id !== original.id)!;
    expect(next).toMatchObject({ completed: false, priority: 'high', is_recurring: true, recurrence_pattern: 'weekly' });
    expect(new Date(next.due_date).getTime() - new Date(original.due_date).getTime()).toBe(7 * 86_400_000);
  });

  for (const [label, due, pattern, expected] of [
    ['monthly Jan 31 → Feb 28', '2027-01-31T09:00:00+08:00', 'monthly', '2027-02-28T09:00:00+08:00'],
    ['yearly Feb 29 → Feb 28', '2028-02-29T09:00:00+08:00', 'yearly', '2029-02-28T09:00:00+08:00'],
  ] as const) {
    test(`clamps ${label}`, async () => {
      const todo = await h.apiCreateTodo({ title: label, due_date: due, is_recurring: true, recurrence_pattern: pattern });
      const res = await (await h.request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).json();
      expect(res.next_instance.due_date).toBe(expected);
    });
  }

  test('double-submitting completion creates exactly one next instance', async () => {
    const todo = await h.apiCreateTodo({ title: 'Once', due_date: isoFromNow(60), is_recurring: true, recurrence_pattern: 'daily' });
    const [a, b] = await Promise.all([
      h.request.put(`/api/todos/${todo.id}`, { data: { completed: true } }),
      h.request.put(`/api/todos/${todo.id}`, { data: { completed: true } }),
    ]);
    const spawned = [await a.json(), await b.json()].filter((r) => r.next_instance);
    expect(spawned).toHaveLength(1);
    expect(await allTodos()).toHaveLength(2);
  });

  test('unchecking Repeat removes the badge and stops recurrence', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Stop me', due_date: isoFromNow(60), is_recurring: true, recurrence_pattern: 'daily' });
    await page.reload();
    await h.item('Stop me').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Edit Repeat').uncheck();
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(h.item('Stop me').getByTestId('recurrence-badge')).toHaveCount(0);

    await h.item('Stop me').getByRole('checkbox').check();
    await expect(h.section('completed').getByText('Stop me')).toBeVisible();
    const todos = await allTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({ is_recurring: false, recurrence_pattern: null });
  });

  test('completing a non-recurring todo spawns nothing; deleting a recurring one leaves no rows', async () => {
    const plain = await h.apiCreateTodo({ title: 'Plain', due_date: isoFromNow(60) });
    const res = await (await h.request.put(`/api/todos/${plain.id}`, { data: { completed: true } })).json();
    expect(res.next_instance).toBeUndefined();

    const rec = await h.apiCreateTodo({ title: 'Rec', due_date: isoFromNow(60), is_recurring: true, recurrence_pattern: 'daily' });
    await h.request.delete(`/api/todos/${rec.id}`);
    expect((await allTodos()).map((t) => t.title)).toEqual(['Plain']);
  });
});
