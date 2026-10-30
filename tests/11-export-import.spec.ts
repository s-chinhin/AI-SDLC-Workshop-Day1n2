import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { TodoHelpers, isoFromNow, signedInContext } from './helpers';
import { toSingaporeDateKey } from '../lib/timezone';

test.describe('Export & import (PRP 09)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  async function seed() {
    const work = await h.apiCreateTag('Work', '#EF4444');
    const todo = await h.apiCreateTodo({
      title: 'Ship v2',
      priority: 'high',
      due_date: isoFromNow(600),
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 60,
      tag_ids: [work.id],
    });
    for (const title of ['Write notes', 'Tag release']) {
      await h.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title } });
    }
    const done = await h.apiCreateTodo({ title: 'Buy milk, eggs, "bread"' });
    await h.request.put(`/api/todos/${done.id}`, { data: { completed: true } });
  }

  test('Export JSON downloads todos-YYYY-MM-DD.json with subtasks and tags, no ids', async ({ page }) => {
    await seed();
    await page.reload();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export JSON' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`todos-${toSingaporeDateKey(new Date())}.json`);

    const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
    expect(data.version).toBe(1);
    const ship = data.todos.find((t: { title: string }) => t.title === 'Ship v2');
    expect(ship).toMatchObject({ priority: 'high', is_recurring: true, recurrence_pattern: 'weekly', reminder_minutes: 60 });
    expect(ship.subtasks.map((s: { title: string }) => s.title)).toEqual(['Write notes', 'Tag release']);
    expect(ship.tags).toEqual([{ name: 'Work', color: '#EF4444' }]);
    expect(ship.id).toBeUndefined();
    expect(ship.user_id).toBeUndefined();
  });

  test('Export CSV has the fixed columns and RFC 4180 quoting', async ({ page }) => {
    await seed();
    const res = await page.request.get('/api/todos/export?format=csv');
    expect(res.headers()['content-disposition']).toContain(`todos-${toSingaporeDateKey(new Date())}.csv`);
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder');
    expect(lines.find((l) => l.includes('milk'))).toMatch(/^\d+,"Buy milk, eggs, ""bread""",Yes,,medium,No,,$/);
    expect(lines.find((l) => l.includes('Ship v2'))).toMatch(/,No,.*\+08:00,high,Yes,weekly,60$/);
  });

  test('round trip: export from one account, import into another via the UI', async ({ browser, page }) => {
    await seed();
    const exported = await (await page.request.get('/api/todos/export?format=json')).text();

    const other = await signedInContext(browser, 'importer');
    const o = new TodoHelpers(other.page);
    await o.apiCreateTag('work', '#000000'); // case-insensitive match → reused, keeps its color
    await other.page.reload();

    await other.page.getByLabel('Import todos file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exported),
    });
    await expect(other.page.getByTestId('notice')).toHaveText('Successfully imported 2 todos');
    await expect(o.item('Ship v2')).toBeVisible();
    await expect(o.section('completed').getByText('Buy milk, eggs, "bread"')).toBeVisible();

    const todos = await (await other.page.request.get('/api/todos')).json();
    const ship = todos.find((t: { title: string }) => t.title === 'Ship v2');
    expect(ship.subtasks.map((s: { title: string; position: number }) => [s.title, s.position])).toEqual([
      ['Write notes', 1],
      ['Tag release', 2],
    ]);
    expect(ship.tags.map((t: { name: string; color: string }) => [t.name, t.color])).toEqual([['work', '#000000']]);
    const tags = await (await other.page.request.get('/api/tags')).json();
    expect(tags).toHaveLength(1);

    // Importing again duplicates by design.
    await other.page.request.post('/api/todos/import', { data: Buffer.from(exported), headers: { 'Content-Type': 'application/json' } });
    expect(await (await other.page.request.get('/api/todos')).json()).toHaveLength(4);
    await other.context.close();
  });

  test('bad files: invalid JSON vs wrong structure; nothing is written', async ({ page }) => {
    const post = (body: string) => page.request.post('/api/todos/import', { data: Buffer.from(body), headers: { 'Content-Type': 'application/json' } });

    const notJson = await post('{oops');
    expect(notJson.status()).toBe(400);
    expect((await notJson.json()).error).toBe('Invalid JSON format');

    const valid = {
      title: 'ok',
      completed: false,
      due_date: null,
      priority: 'low',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      created_at: '2026-01-01T00:00:00Z',
      subtasks: [],
      tags: [],
    };
    for (const bad of [
      { version: 2, exported_at: '', todos: [] },
      { version: 1, exported_at: '', todos: [valid, { ...valid, priority: 'urgent' }] }, // second item bad → none imported
      { version: 1, exported_at: '', todos: [{ ...valid, is_recurring: true, recurrence_pattern: 'daily' }] }, // no due date
      { todos: [] },
    ]) {
      const res = await post(JSON.stringify(bad));
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('Failed to import todos. Please check the file format.');
    }
    expect(await (await page.request.get('/api/todos')).json()).toEqual([]);

    const empty = await post(JSON.stringify({ version: 1, exported_at: '', todos: [] }));
    expect(await empty.json()).toMatchObject({ success: true, imported: 0 });
  });

  test('UI shows the import error banner', async ({ page }) => {
    await page.getByLabel('Import todos file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await expect(page.getByTestId('error-banner')).toContainText('Invalid JSON format');
  });

  test('export and import require a session', async ({ baseURL }) => {
    const anon = await playwrightRequest.newContext({ baseURL });
    expect((await anon.get('/api/todos/export?format=json')).status()).toBe(401);
    expect((await anon.post('/api/todos/import', { data: {} })).status()).toBe(401);
    await anon.dispose();
  });
});
