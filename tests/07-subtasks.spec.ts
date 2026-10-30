import { test, expect } from '@playwright/test';
import { TodoHelpers, signedInContext } from './helpers';

test.describe('Subtasks & progress (PRP 05)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('no progress UI with zero subtasks; toggle still available', async () => {
    await h.apiCreateTodo({ title: 'Empty' });
    await h.page.reload();
    const item = h.item('Empty');
    await expect(item.getByTestId('subtask-progress')).toHaveCount(0);
    await expect(item.getByRole('button', { name: '▶ Subtasks' })).toBeVisible();
  });

  test('add, toggle and delete update progress immediately; bar is blue then green at 100%', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Trip' });
    await page.reload();
    await h.addSubtask('Trip', 'Book flights');
    await h.addSubtask('Trip', 'Pack');
    await h.addSubtask('Trip', 'Passport');

    const item = h.item('Trip');
    await expect(item.getByTestId('progress-text')).toHaveText('0/3 subtasks');
    await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    await item.getByLabel('Mark subtask "Book flights" as complete').check();
    await item.getByLabel('Mark subtask "Pack" as complete').check();
    await expect(item.getByTestId('progress-text')).toHaveText('2/3 subtasks');
    await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
    await expect(item.getByTestId('progress-fill')).toHaveClass(/bg-blue-500/);

    // Deleting the last incomplete one makes it 100% → green.
    await item.getByLabel('Delete subtask "Passport"').click();
    await expect(item.getByTestId('progress-text')).toHaveText('2/2 subtasks');
    await expect(item.getByTestId('progress-fill')).toHaveClass(/bg-green-500/);

    // Parent stays incomplete: subtasks are independent.
    await expect(h.section('pending').getByText('Trip')).toBeVisible();

    // Collapsed: list hidden, progress still visible; persists across reload.
    await item.getByRole('button', { name: '▼ Subtasks' }).click();
    await expect(item.getByTestId('subtask-panel')).toHaveCount(0);
    await expect
      .poll(async () => {
        const todos = await (await page.request.get('/api/todos')).json();
        return todos[0].subtasks.map((s: { completed: boolean }) => s.completed);
      })
      .toEqual([true, true]);
    await page.reload();
    await expect(h.item('Trip').getByTestId('progress-text')).toHaveText('2/2 subtasks');
  });

  test('empty subtask title is rejected client- and server-side', async ({ page }) => {
    const todo = await h.apiCreateTodo({ title: 'Parent' });
    await page.reload();
    await h.item('Parent').getByRole('button', { name: '▶ Subtasks' }).click();
    await h.item('Parent').getByLabel('New subtask').fill('   ');
    await expect(h.item('Parent').getByRole('button', { name: 'Add' })).toBeDisabled();

    const res = await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: '  ' } });
    expect(res.status()).toBe(400);
  });

  test('positions append at max+1 and deletes do not renumber', async ({ page }) => {
    const todo = await h.apiCreateTodo({ title: 'Ordered' });
    const add = async (title: string) =>
      (await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title } })).json();
    const a = await add('a');
    const b = await add('b');
    expect([a.position, b.position]).toEqual([1, 2]);
    await page.request.delete(`/api/subtasks/${a.id}`);
    const c = await add('c');
    expect(c.position).toBe(3);
    const fetched = await (await page.request.get(`/api/todos/${todo.id}`)).json();
    expect(fetched.subtasks.map((s: { title: string; position: number }) => [s.title, s.position])).toEqual([
      ['b', 2],
      ['c', 3],
    ]);
  });

  test('deleting the parent todo cascades its subtasks (PRP 01)', async ({ page }) => {
    const todo = await h.apiCreateTodo({ title: 'Has kids' });
    const sub = await (await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'kid' } })).json();
    await page.reload();
    await h.item('Has kids').getByRole('button', { name: 'Delete' }).click();
    await expect(h.item('Has kids')).toHaveCount(0);
    await expect.poll(async () => (await page.request.put(`/api/subtasks/${sub.id}`, { data: { completed: true } })).status()).toBe(404);
  });

  test("another user's subtasks and todos return 404", async ({ browser, page }) => {
    const todo = await h.apiCreateTodo({ title: 'Mine' });
    const sub = await (await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'secret' } })).json();

    const other = await signedInContext(browser, 'intruder');
    const r = other.page.request;
    expect((await r.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'x' } })).status()).toBe(404);
    expect((await r.put(`/api/subtasks/${sub.id}`, { data: { completed: true } })).status()).toBe(404);
    expect((await r.delete(`/api/subtasks/${sub.id}`)).status()).toBe(404);
    await other.context.close();
  });
});
