import { test, expect, type Page } from '@playwright/test';
import { TodoHelpers } from './helpers';

const visibleTitles = (page: Page) => page.getByTestId('todo-item').locator('p');

test.describe('Search & filtering (PRP 08)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('search matches titles and subtask titles, case-insensitive and partial', async ({ page }) => {
    const todo = await h.apiCreateTodo({ title: 'Plan offsite' });
    await page.request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'Book MEETING room' } });
    await h.apiCreateTodo({ title: 'Team meeting notes' });
    await h.apiCreateTodo({ title: 'Groceries' });
    await page.reload();

    await page.getByLabel('Search todos').fill('meet');
    await expect(visibleTitles(page)).toHaveCount(2);
    await expect(h.item('Groceries')).toHaveCount(0);

    await page.getByLabel('Search todos').fill('OFFS');
    await expect(visibleTitles(page)).toHaveText(['Plan offsite']);
  });

  test('search is debounced ~300ms; ✕ clears immediately', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Alpha' });
    await h.apiCreateTodo({ title: 'Beta' });
    await page.clock.install();
    await page.reload();
    await expect(visibleTitles(page)).toHaveCount(2);

    await page.getByLabel('Search todos').fill('alp');
    await page.clock.runFor(100);
    await expect(visibleTitles(page)).toHaveCount(2); // not applied yet
    await page.clock.runFor(250);
    await expect(visibleTitles(page)).toHaveText(['Alpha']);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(visibleTitles(page)).toHaveCount(2); // no waiting
    await expect(page.getByLabel('Search todos')).toHaveValue('');
  });

  test('filters combine with AND; post-filter counts; empty sections hidden; Clear All resets', async ({ page }) => {
    const work = await h.apiCreateTag('Work');
    await h.apiCreateTodo({ title: 'Report draft', priority: 'high', tag_ids: [work.id] });
    await h.apiCreateTodo({ title: 'Report review', priority: 'low', tag_ids: [work.id] });
    await h.apiCreateTodo({ title: 'Report personal', priority: 'high' });
    const done = await h.apiCreateTodo({ title: 'Report done', priority: 'high', tag_ids: [work.id] });
    await page.request.put(`/api/todos/${done.id}`, { data: { completed: true } });
    await page.reload();

    await page.getByLabel('Search todos').fill('report');
    await page.getByLabel('Filter by priority').selectOption('high');
    await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
    await expect(visibleTitles(page)).toHaveText(['Report draft', 'Report done']);
    await expect(h.section('pending').getByRole('heading')).toHaveText('Pending (1)');
    await expect(h.section('completed').getByRole('heading')).toHaveText('Completed (1)');

    await page.getByRole('button', { name: '▶ Advanced' }).click();
    await page.getByLabel('Completion status').selectOption('incomplete');
    await expect(visibleTitles(page)).toHaveText(['Report draft']);
    await expect(h.section('completed')).toHaveCount(0); // empty while filtering → hidden

    await page.getByRole('button', { name: 'Clear All' }).first().click();
    await expect(visibleTitles(page)).toHaveCount(4);
    await expect(page.getByLabel('Search todos')).toHaveValue('');
    await expect(page.getByLabel('Completion status')).toHaveValue('all');
    await expect(page.getByRole('button', { name: '💾 Save Filter' })).toHaveCount(0);
  });

  test('due date range: only dated todos, each bound optional (Singapore days)', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Nov 3', due_date: '2027-11-03T23:30:00+08:00' });
    await h.apiCreateTodo({ title: 'Nov 5', due_date: '2027-11-05T00:30:00+08:00' });
    await h.apiCreateTodo({ title: 'Nov 9', due_date: '2027-11-09T09:00:00+08:00' });
    await h.apiCreateTodo({ title: 'No date' });
    await page.reload();
    await page.getByRole('button', { name: '▶ Advanced' }).click();

    await page.getByLabel('Due date from').fill('2027-11-04');
    await expect(visibleTitles(page)).toHaveText(['Nov 5', 'Nov 9']);
    await page.getByLabel('Due date to').fill('2027-11-05');
    await expect(visibleTitles(page)).toHaveText(['Nov 5']);
    await page.getByLabel('Due date from').fill('');
    await expect(visibleTitles(page)).toHaveText(['Nov 3', 'Nov 5']);
  });

  test('distinct empty states: no todos vs no matches', async ({ page }) => {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await h.apiCreateTodo({ title: 'Something' });
    await page.reload();
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
    await page.getByLabel('Search todos').fill('zzz');
    await expect(page.getByTestId('no-matches')).toBeVisible();
  });

  test('save a preset with preview, persist across reload, apply in one click, delete', async ({ page }) => {
    const work = await h.apiCreateTag('Work');
    await h.apiCreateTodo({ title: 'meeting prep', priority: 'high', tag_ids: [work.id] });
    await h.apiCreateTodo({ title: 'meeting other', priority: 'low' });
    await page.reload();

    await page.getByLabel('Search todos').fill('meeting');
    await page.getByLabel('Filter by priority').selectOption('high');
    await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
    await page.getByRole('button', { name: '▶ Advanced' }).click();
    await page.getByLabel('Completion status').selectOption('incomplete');
    await page.getByLabel('Due date from').fill('2025-11-01');
    await page.getByLabel('Due date to').fill('2030-11-07');

    await page.getByRole('button', { name: '💾 Save Filter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save filter' });
    await expect(dialog.getByTestId('filter-preview')).toHaveText(
      'Search: "meeting" · Priority: High · Tag: Work · Completion: Incomplete · Date: 2025-11-01 to 2030-11-07'
    );
    await dialog.getByLabel('Filter name').fill('Hot work');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await page.reload();
    await page.getByRole('button', { name: '▶ Advanced' }).click();
    await expect(visibleTitles(page)).toHaveCount(2); // filters not active after reload
    await page.getByTestId('filter-preset').getByRole('button', { name: 'Hot work', exact: true }).click();
    await expect(page.getByLabel('Search todos')).toHaveValue('meeting');
    await expect(page.getByLabel('Filter by priority')).toHaveValue('high');
    await expect(page.getByLabel('Completion status')).toHaveValue('incomplete');
    await expect(page.getByLabel('Due date to')).toHaveValue('2030-11-07');
    await expect(visibleTitles(page)).toHaveCount(0); // date range excludes undated todos

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete saved filter "Hot work"' }).click();
    await expect(page.getByTestId('filter-preset')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('todo-app:filter-presets'));
    expect(JSON.parse(stored!)).toEqual([]);
  });
});
