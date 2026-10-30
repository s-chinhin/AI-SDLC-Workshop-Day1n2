import { test, expect, request as playwrightRequest } from '@playwright/test';
import { TodoHelpers, isoFromNow, sgDatetimeLocal, signedInContext } from './helpers';

test.describe('Todo CRUD (PRP 01)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('create todo with title only → appears in Pending', async () => {
    await h.createTodo('Buy groceries');
    await expect(h.section('pending').getByText('Buy groceries')).toBeVisible();
    await expect(h.section('pending').getByRole('heading')).toHaveText('Pending (1)');

    await h.page.reload();
    await expect(h.section('pending').getByText('Buy groceries')).toBeVisible();
  });

  test('create todo with a future due date shows the date', async () => {
    await h.createTodo('Dentist', { due: sgDatetimeLocal(90) });
    const item = h.item('Dentist');
    await expect(item).toBeVisible();
    await expect(item).toContainText('in 1 hour');
  });

  test('empty title → validation error, no API call', async ({ page }) => {
    let posted = false;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/todos') && r.method() === 'POST') posted = true;
    });
    await page.getByLabel('Todo title').fill('   ');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('form-error')).toHaveText('Title is required');
    expect(posted).toBe(false);
  });

  test('past due date → error, todo not created', async ({ page }) => {
    await h.createTodo('Too late', { due: sgDatetimeLocal(-60) });
    await expect(page.getByTestId('form-error')).toContainText('at least 1 minute in the future');
    await expect(h.item('Too late')).toHaveCount(0);
  });

  test('edit title and due date → list re-sorts', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Alpha', due_date: isoFromNow(300) });
    await h.apiCreateTodo({ title: 'Beta', due_date: isoFromNow(600) });
    await page.reload();
    const titles = h.section('pending').getByTestId('todo-item').locator('p');
    await expect(titles).toHaveText(['Alpha', 'Beta']);

    await h.item('Beta').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Edit title').fill('Beta renamed');
    await page.getByLabel('Edit due date').fill(sgDatetimeLocal(60));
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titles).toHaveText(['Beta renamed', 'Alpha']);
  });

  test('cancel edit (button, Escape, outside click) → unchanged, no API call', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Keep me' });
    await page.reload();
    let puts = 0;
    page.on('request', (r) => r.method() === 'PUT' && puts++);

    const openAndType = async () => {
      await h.item('Keep me').getByRole('button', { name: 'Edit' }).click();
      await page.getByLabel('Edit title').fill('Changed');
    };

    await openAndType();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await openAndType();
    await page.keyboard.press('Escape');
    await openAndType();
    await page.getByTestId('edit-modal-backdrop').click({ position: { x: 5, y: 5 } });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(h.item('Keep me')).toBeVisible();
    expect(puts).toBe(0);
  });

  test('toggle completion moves between Pending/Overdue and Completed', async ({ page }) => {
    await page.clock.install();
    await h.apiCreateTodo({ title: 'Soon', due_date: isoFromNow(2) });
    await page.reload();

    await h.item('Soon').getByRole('checkbox').check();
    await expect(h.section('completed').getByText('Soon')).toBeVisible();
    await h.item('Soon').getByRole('checkbox').uncheck();
    await expect(h.section('pending').getByText('Soon')).toBeVisible();

    // Let the due date pass in the browser; unchecking now lands in Overdue.
    await page.clock.fastForward('03:00');
    await expect(h.section('overdue').getByText('Soon')).toBeVisible();
    await h.item('Soon').getByRole('checkbox').check();
    await expect(h.section('completed').getByText('Soon')).toBeVisible();
    await h.item('Soon').getByRole('checkbox').uncheck();
    await expect(h.section('overdue').getByText('Soon')).toBeVisible();
  });

  test('delete → removed immediately (no confirm) and gone after reload', async ({ page }) => {
    page.on('dialog', () => {
      throw new Error('No confirmation dialog expected');
    });
    await h.apiCreateTodo({ title: 'Trash me' });
    await page.reload();
    const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE');
    await h.item('Trash me').getByRole('button', { name: 'Delete' }).click();
    await expect(h.item('Trash me')).toHaveCount(0);
    expect((await deleted).ok()).toBe(true);

    await page.reload();
    await expect(h.section('pending')).toBeVisible();
    await expect(h.item('Trash me')).toHaveCount(0);
    const list = await (await h.request.get('/api/todos')).json();
    expect(list.find((t: { title: string }) => t.title === 'Trash me')).toBeUndefined();
  });

  test('failed create rolls back the optimistic todo', async ({ page }) => {
    await page.route('**/api/todos', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    await h.createTodo('Doomed');
    await expect(page.getByTestId('error-banner')).toContainText('Could not create todo');
    await expect(h.item('Doomed')).toHaveCount(0);
  });
});

test.describe('Todo API (PRP 01)', () => {
  test('requests without a session return 401', async ({ baseURL }) => {
    const anon = await playwrightRequest.newContext({ baseURL });
    expect((await anon.post('/api/todos', { data: { title: 'x' } })).status()).toBe(401);
    expect((await anon.get('/api/todos')).status()).toBe(401);
    await anon.dispose();
  });

  test('POST persists fields with defaults and rejects blank titles', async ({ browser }) => {
    const { context, page } = await signedInContext(browser);
    const request = page.request;
    const due = isoFromNow(90);
    const res = await request.post('/api/todos', { data: { title: '  Report  ', due_date: due } });
    expect(res.status()).toBe(201);
    const todo = await res.json();
    expect(todo).toMatchObject({ title: 'Report', completed: false, priority: 'medium' });
    expect(new Date(todo.due_date).getTime()).toBe(new Date(due).getTime() - (new Date(due).getTime() % 1000));
    expect(todo.due_date).toMatch(/\+08:00$/);

    expect((await request.post('/api/todos', { data: { title: '   ' } })).status()).toBe(400);
    expect((await request.post('/api/todos', { data: { title: 'x', due_date: 'garbage' } })).status()).toBe(400);
    await context.close();
  });

  test("another user's todo returns 404 for GET/PUT/DELETE", async ({ browser }) => {
    const a = await signedInContext(browser, 'alice');
    const b = await signedInContext(browser, 'bob');
    const alice = a.page.request;
    const bob = b.page.request;

    const todo = await (await alice.post('/api/todos', { data: { title: 'Private' } })).json();
    const url = `/api/todos/${todo.id}`;
    expect((await bob.get(url)).status()).toBe(404);
    expect((await bob.put(url, { data: { title: 'hacked' } })).status()).toBe(404);
    expect((await bob.delete(url)).status()).toBe(404);
    expect((await alice.get(url)).status()).toBe(200);

    await a.context.close();
    await b.context.close();
  });
});
