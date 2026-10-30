import { test, expect } from '@playwright/test';
import { TodoHelpers, sgDatetimeLocal, signedInContext } from './helpers';

test.describe('Template system (PRP 07)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  const createTemplate = async (data: Record<string, unknown>) => {
    const res = await h.request.post('/api/templates', { data });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  };

  test('save the form as a template (priority, repeat, reminder, 2 subtasks) and use it from the dropdown', async ({ page }) => {
    const tag = await h.apiCreateTag('Never copied');
    await page.reload();

    await page.getByLabel('Todo title').fill('Monthly bills');
    await page.getByLabel('Due date', { exact: true }).fill(sgDatetimeLocal(1440));
    await page.getByLabel('Priority', { exact: true }).selectOption('high');
    await page.getByLabel('Repeat', { exact: true }).check();
    await page.getByLabel('Recurrence pattern', { exact: true }).selectOption('monthly');
    await page.getByLabel('Reminder', { exact: true }).selectOption('60');
    await page.getByTestId('tag-selector').getByRole('button', { name: tag.name }).click();

    await page.getByRole('button', { name: '💾 Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save template' });
    await dialog.getByLabel('Template name').fill('Bills');
    await dialog.getByLabel('Template category').fill('Finance');
    for (const s of ['Electricity', 'Internet']) {
      await dialog.getByLabel('Template subtask').fill(s);
      await dialog.getByRole('button', { name: 'Add subtask' }).click();
    }
    await dialog.getByLabel('Due date offset').selectOption('1440');
    await dialog.getByRole('button', { name: 'Save Template' }).click();
    await expect(dialog).toHaveCount(0);

    // In the quick dropdown as "{name} ({category})" and in the manager.
    const quick = page.getByLabel('Use Template');
    await expect(quick.locator('option')).toHaveText(['Use Template…', 'Bills (Finance)']);
    await page.getByRole('button', { name: '📋 Templates' }).click();
    const card = page.getByRole('dialog', { name: 'Templates' }).getByTestId('template-card');
    await expect(card).toContainText('Bills');
    await expect(card.getByTestId('priority-badge')).toHaveText('High');
    await expect(card.getByTestId('recurrence-badge')).toContainText('monthly');
    await expect(card.getByTestId('reminder-badge')).toContainText('1h');
    await page.getByRole('button', { name: 'Close' }).click();

    await quick.selectOption({ label: 'Bills (Finance)' });
    const items = h.item('Monthly bills');
    await expect(items).toHaveCount(1); // form not submitted; only the template-created todo exists
    const created = (await (await page.request.get('/api/todos')).json())[0];
    expect(created).toMatchObject({ title: 'Monthly bills', priority: 'high', is_recurring: true, recurrence_pattern: 'monthly', reminder_minutes: 60 });
    expect(created.subtasks.map((s: { title: string; completed: boolean }) => [s.title, s.completed])).toEqual([
      ['Electricity', false],
      ['Internet', false],
    ]);
    expect(created.tags).toEqual([]);
    const offsetMin = (new Date(created.due_date).getTime() - Date.now()) / 60_000;
    expect(offsetMin).toBeGreaterThan(1438);
    expect(offsetMin).toBeLessThanOrEqual(1440);
    expect(created.due_date).toMatch(/\+08:00$/);
  });

  test('use from the manager closes the modal; a template without subtasks makes none', async ({ page }) => {
    await createTemplate({ name: 'Quick note', title_template: 'Jot it down', priority: 'low' });
    await page.reload();
    await page.getByRole('button', { name: '📋 Templates' }).click();
    await page.getByTestId('template-card').getByRole('button', { name: 'Use' }).click();
    await expect(page.getByRole('dialog', { name: 'Templates' })).toHaveCount(0);
    await expect(h.item('Jot it down')).toBeVisible();
    const todo = (await (await page.request.get('/api/todos')).json())[0];
    expect(todo).toMatchObject({ due_date: null, subtasks: [] });
  });

  test('deleting a template leaves todos created from it untouched', async ({ page }) => {
    const t = await createTemplate({ name: 'Temp', title_template: 'From template', subtasks: ['one'] });
    await page.request.post(`/api/templates/${t.id}/use`);
    await page.reload();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '📋 Templates' }).click();
    await page.getByTestId('template-card').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('template-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Use Template')).toHaveCount(0);

    await expect(h.item('From template')).toBeVisible();
    expect((await page.request.post(`/api/templates/${t.id}/use`)).status()).toBe(404);
  });

  test('duplicate template names are allowed', async () => {
    await createTemplate({ name: 'Weekly Review', title_template: 'a' });
    await createTemplate({ name: 'Weekly Review', title_template: 'b' });
    expect(await (await h.request.get('/api/templates')).json()).toHaveLength(2);
  });

  test('validation: name/title required; recurring or reminder needs an offset', async ({ page }) => {
    const post = (data: Record<string, unknown>) => page.request.post('/api/templates', { data });
    expect((await post({ title_template: 'x' })).status()).toBe(400);
    expect((await post({ name: 'x' })).status()).toBe(400);
    const rec = await post({ name: 'r', title_template: 'r', is_recurring: true, recurrence_pattern: 'daily' });
    expect(rec.status()).toBe(400);
    expect((await rec.json()).error).toBe('Recurring templates need a due date offset');
    expect((await post({ name: 'r', title_template: 'r', reminder_minutes: 15 })).status()).toBe(400);
    expect((await post({ name: 'r', title_template: 'r', due_date_offset_minutes: 0 })).status()).toBe(400);
    expect((await post({ name: 'r', title_template: 'r', priority: 'urgent' })).status()).toBe(400);
  });

  test("templates are per user", async ({ browser, page }) => {
    const t = await createTemplate({ name: 'Private', title_template: 'secret' });
    const other = await signedInContext(browser, 'other');
    const r = other.page.request;
    expect(await (await r.get('/api/templates')).json()).toEqual([]);
    expect((await r.post(`/api/templates/${t.id}/use`)).status()).toBe(404);
    expect((await r.put(`/api/templates/${t.id}`, { data: { name: 'x', title_template: 'x' } })).status()).toBe(404);
    expect((await r.delete(`/api/templates/${t.id}`)).status()).toBe(404);
    await other.context.close();
    expect(await (await page.request.get('/api/templates')).json()).toHaveLength(1);
  });
});
