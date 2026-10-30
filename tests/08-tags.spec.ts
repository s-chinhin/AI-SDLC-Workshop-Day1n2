import { test, expect, request as playwrightRequest } from '@playwright/test';
import { TodoHelpers, isoFromNow, signedInContext } from './helpers';

test.describe('Tag system (PRP 06)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('create tags in the modal, apply several to a new todo', async ({ page }) => {
    await h.createTag('Work', '#EF4444');
    await h.createTag('Urgent');

    const selector = page.getByTestId('tag-selector');
    await selector.getByRole('button', { name: 'Work' }).click();
    await selector.getByRole('button', { name: 'Urgent' }).click();
    await expect(selector.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
    await h.createTodo('Quarterly report');

    const chips = h.item('Quarterly report').getByTestId('todo-tag');
    await expect(chips).toHaveText(['Urgent', 'Work']);
    await expect(chips.first()).toHaveCSS('background-color', 'rgb(59, 130, 246)'); // default #3B82F6
    await expect(chips.last()).toHaveCSS('background-color', 'rgb(239, 68, 68)');
    await expect(chips.first()).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.reload();
    await expect(h.item('Quarterly report').getByTestId('todo-tag')).toHaveText(['Urgent', 'Work']);
  });

  test('editing a tag updates every todo that uses it', async ({ page }) => {
    const tag = await h.apiCreateTag('Home');
    await h.apiCreateTodo({ title: 'Fix sink', tag_ids: [tag.id] });
    await h.apiCreateTodo({ title: 'Mow lawn', tag_ids: [tag.id] });
    await page.reload();

    await page.getByRole('button', { name: '+ Manage Tags' }).click();
    const dialog = page.getByRole('dialog', { name: 'Manage tags' });
    await dialog.getByTestId('tag-row').filter({ hasText: 'Home' }).getByRole('button', { name: 'Edit' }).click();
    await dialog.getByLabel('Tag name', { exact: true }).fill('House');
    await dialog.getByLabel('Tag color hex', { exact: true }).fill('#10B981');
    await dialog.getByRole('button', { name: 'Update' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();

    for (const title of ['Fix sink', 'Mow lawn']) {
      const chip = h.item(title).getByTestId('todo-tag');
      await expect(chip).toHaveText('House');
      await expect(chip).toHaveCSS('background-color', 'rgb(16, 185, 129)');
    }
  });

  test('deleting a tag removes it from todos, keeps other tags, and resets an active filter', async ({ page }) => {
    const a = await h.apiCreateTag('Alpha');
    const b = await h.apiCreateTag('Beta');
    await h.apiCreateTodo({ title: 'Both', tag_ids: [a.id, b.id] });
    await h.apiCreateTodo({ title: 'Only alpha', tag_ids: [a.id] });
    await page.reload();

    await page.getByLabel('Filter by tag').selectOption({ label: 'Alpha' });
    await expect(page.getByTestId('todo-item')).toHaveCount(2);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '+ Manage Tags' }).click();
    const dialog = page.getByRole('dialog', { name: 'Manage tags' });
    await dialog.getByTestId('tag-row').filter({ hasText: 'Alpha' }).getByRole('button', { name: 'Delete' }).click();
    await expect(dialog.getByTestId('tag-row')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close' }).click();

    await expect(page.getByLabel('Filter by tag')).toHaveValue('');
    await expect(page.getByTestId('todo-item')).toHaveCount(2);
    await expect(h.item('Both').getByTestId('todo-tag')).toHaveText(['Beta']);
    await expect(h.item('Only alpha').getByTestId('todo-tag')).toHaveCount(0);
  });

  test('filter by tag via dropdown and by clicking a chip; All Tags clears it', async ({ page }) => {
    const work = await h.apiCreateTag('Work');
    const home = await h.apiCreateTag('Home');
    await h.apiCreateTodo({ title: 'Deck', tag_ids: [work.id] });
    await h.apiCreateTodo({ title: 'Laundry', tag_ids: [home.id] });
    await h.apiCreateTodo({ title: 'Untagged' });
    await page.reload();

    await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
    await expect(page.getByTestId('todo-item')).toHaveText([/Deck/]);
    await page.getByLabel('Filter by tag').selectOption('');
    await expect(page.getByTestId('todo-item')).toHaveCount(3);

    await h.item('Laundry').getByTestId('todo-tag').click();
    await expect(page.getByTestId('todo-item')).toHaveText([/Laundry/]);
    await expect(page.getByLabel('Filter by tag')).toHaveValue(String(home.id));
  });

  test('edit modal changes a todo’s tags', async ({ page }) => {
    const a = await h.apiCreateTag('A');
    await h.apiCreateTag('B');
    await h.apiCreateTodo({ title: 'Retag me', tag_ids: [a.id] });
    await page.reload();
    await h.item('Retag me').getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit todo' });
    await dialog.getByRole('button', { name: 'A', exact: true }).click();
    await dialog.getByRole('button', { name: 'B', exact: true }).click();
    await dialog.getByRole('button', { name: 'Update' }).click();
    await expect(h.item('Retag me').getByTestId('todo-tag')).toHaveText(['B']);
  });

  test('duplicate name is rejected in the modal and the API', async ({ page }) => {
    await h.createTag('Errands');
    await page.getByRole('button', { name: '+ Manage Tags' }).click();
    const dialog = page.getByRole('dialog', { name: 'Manage tags' });
    await dialog.getByLabel('New tag name').fill('Errands');
    await dialog.getByRole('button', { name: 'Create Tag' }).click();
    await expect(dialog.getByTestId('tag-error')).toHaveText('A tag with this name already exists');

    expect((await page.request.post('/api/tags', { data: { name: 'Errands' } })).status()).toBe(409);
  });

  test('API validation: name required, hex colors only, default color', async ({ page }) => {
    expect((await page.request.post('/api/tags', { data: { name: '   ' } })).status()).toBe(400);
    for (const color of ['red', '#12345', '#GGGGGG', '3B82F6']) {
      expect((await page.request.post('/api/tags', { data: { name: `c${color}`, color } })).status()).toBe(400);
    }
    const tag = await h.apiCreateTag('Plain');
    expect(tag.color).toBe('#3B82F6');
  });

  test('attach/detach are idempotent', async ({ page }) => {
    const tag = await h.apiCreateTag('Idem');
    const todo = await h.apiCreateTodo({ title: 'T' });
    const url = `/api/todos/${todo.id}/tags`;
    for (let i = 0; i < 2; i++) {
      const res = await page.request.post(url, { data: { tag_id: tag.id } });
      expect(res.status()).toBe(200);
      expect((await res.json()).tags).toHaveLength(1);
    }
    for (let i = 0; i < 2; i++) {
      const res = await page.request.delete(url, { data: { tag_id: tag.id } });
      expect(res.status()).toBe(200);
      expect((await res.json()).tags).toHaveLength(0);
    }
  });

  test('completing a recurring todo copies its tags to the next instance (PRP 03)', async ({ page }) => {
    const tag = await h.apiCreateTag('Recurring');
    const todo = await h.apiCreateTodo({
      title: 'Water plants',
      due_date: isoFromNow(60),
      is_recurring: true,
      recurrence_pattern: 'daily',
      tag_ids: [tag.id],
    });
    const res = await (await page.request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).json();
    expect(res.next_instance.tags.map((t: { name: string }) => t.name)).toEqual(['Recurring']);
  });

  test('scoping: same name allowed for another user; cross-user ids 404; anonymous 401', async ({ browser, page, baseURL }) => {
    const mine = await h.apiCreateTag('Shared name');
    const todo = await h.apiCreateTodo({ title: 'Mine' });

    const other = await signedInContext(browser, 'other');
    const r = other.page.request;
    expect((await r.post('/api/tags', { data: { name: 'Shared name' } })).status()).toBe(201);
    expect((await r.put(`/api/tags/${mine.id}`, { data: { name: 'x' } })).status()).toBe(404);
    expect((await r.delete(`/api/tags/${mine.id}`)).status()).toBe(404);
    expect((await r.post(`/api/todos/${todo.id}/tags`, { data: { tag_id: mine.id } })).status()).toBe(404);
    expect((await r.post('/api/todos', { data: { title: 'steal', tag_ids: [mine.id] } })).status()).toBe(404);
    await other.context.close();

    expect((await page.request.get('/api/tags')).status()).toBe(200);
    const anon = await playwrightRequest.newContext({ baseURL });
    expect((await anon.get('/api/tags')).status()).toBe(401);
    expect((await anon.post('/api/tags', { data: { name: 'x' } })).status()).toBe(401);
    await anon.dispose();
  });
});
