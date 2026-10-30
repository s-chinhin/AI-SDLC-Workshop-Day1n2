import { test, expect } from '@playwright/test';
import { TodoHelpers } from './helpers';
import { toSingaporeDateKey } from '../lib/timezone';

test.describe('Calendar view (PRP 10)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  const cell = (page: import('@playwright/test').Page, date: string) => page.locator(`[data-testid="calendar-day"][data-date="${date}"]`);

  test('opens from the list, defaults to the current Singapore month, 7 headers × 6 rows, today highlighted', async ({ page }) => {
    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    const now = new Date();
    const title = new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(now);
    await expect(page.getByTestId('month-title')).toHaveText(title);
    await expect(page.getByRole('columnheader')).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    await expect(page.getByTestId('calendar-day')).toHaveCount(42);
    await expect(cell(page, toSingaporeDateKey(now))).toHaveAttribute('data-today', 'true');
  });

  test('todos land on the Singapore day with priority colors; >3 shows "+X more"; modal lists all', async ({ page }) => {
    // 00:30 SGT on Mar 1 is still Feb 28 in UTC: must render on March 1.
    await h.apiCreateTodo({ title: 'Just after midnight', due_date: '2027-03-01T00:30:00+08:00', priority: 'high' });
    for (const [i, p] of (['low', 'medium', 'high', 'low', 'medium'] as const).entries()) {
      await h.apiCreateTodo({ title: `Busy ${i}`, due_date: `2027-03-10T0${i + 1}:00:00+08:00`, priority: p });
    }
    await h.apiCreateTodo({ title: 'No date' });

    await page.goto('/calendar?month=2027-03');
    await expect(page.getByTestId('month-title')).toHaveText('March 2027');
    const march1 = cell(page, '2027-03-01');
    await expect(march1.getByTestId('calendar-todo')).toHaveText(['Just after midnight']);
    await expect(march1.getByTestId('calendar-todo')).toHaveAttribute('data-priority', 'high');
    await expect(cell(page, '2027-02-28').getByTestId('calendar-todo')).toHaveCount(0);

    const busy = cell(page, '2027-03-10');
    await expect(busy.getByTestId('calendar-todo')).toHaveCount(3);
    await expect(busy.getByTestId('more-count')).toHaveText('+2 more');
    await expect(page.getByText('No date')).toHaveCount(0);

    await busy.click();
    const modal = page.getByRole('dialog', { name: 'Todos on 2027-03-10' });
    await expect(modal.getByTestId('modal-todos').locator('li')).toHaveCount(5);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });

  test('holidays show on their cell and in the day modal, alongside todos', async ({ page }) => {
    // A past date can't be created through POST /api/todos, but import accepts it.
    const backup = {
      version: 1,
      exported_at: '2026-08-01T00:00:00+08:00',
      todos: [
        {
          title: 'Parade prep',
          completed: false,
          due_date: '2026-08-09T10:00:00+08:00',
          priority: 'medium',
          is_recurring: false,
          recurrence_pattern: null,
          reminder_minutes: null,
          created_at: '2026-08-01T00:00:00+08:00',
          subtasks: [],
          tags: [],
        },
      ],
    };
    const res = await page.request.post('/api/todos/import', {
      data: Buffer.from(JSON.stringify(backup)),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    await page.goto('/calendar?month=2026-08');
    const nd = cell(page, '2026-08-09');
    await expect(nd.getByTestId('holiday-label')).toHaveText('National Day');
    await expect(nd.getByTestId('calendar-todo')).toHaveText(['Parade prep']);
    await expect(cell(page, '2026-08-10').getByTestId('holiday-label')).toHaveText('National Day (observed)');
    await expect(nd).toHaveAttribute('data-weekend', 'true'); // a Sunday

    await nd.click();
    await expect(page.getByTestId('modal-holiday')).toHaveText('🎉 National Day');
  });

  test('prev / next / today update the URL; adjacent-month days are marked', async ({ page }) => {
    await page.goto('/calendar?month=2026-12');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page).toHaveURL(/month=2027-01$/);
    await expect(page.getByTestId('month-title')).toHaveText('January 2027');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page).toHaveURL(/month=2026-11$/);
    // Nov 2026 starts on a Sunday; the grid's last cells belong to December.
    await expect(cell(page, '2026-11-01')).toHaveAttribute('data-current-month', 'true');
    await expect(cell(page, '2026-12-12')).toHaveAttribute('data-current-month', 'false');

    await page.getByRole('button', { name: 'Today' }).click();
    const ym = toSingaporeDateKey(new Date()).slice(0, 7);
    await expect(page).toHaveURL(new RegExp(`month=${ym}$`));
  });

  test('invalid ?month= falls back to the current month', async ({ page }) => {
    const title = new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(new Date());
    for (const bad of ['abc', '2026-13', '2026-00', '']) {
      await page.goto(`/calendar?month=${bad}`);
      await expect(page.getByTestId('month-title')).toHaveText(title);
    }
  });

  test('holidays API is scoped to the visible grid and needs a session', async ({ page, baseURL }) => {
    const { holidays } = await (await page.request.get('/api/holidays?year=2026&month=2')).json();
    expect(holidays.map((x: { date: string }) => x.date)).toEqual(['2026-02-17', '2026-02-18']);
    expect((await page.request.get('/api/holidays?year=2026&month=13')).status()).toBe(400);
    const { request } = await import('@playwright/test');
    const anon = await request.newContext({ baseURL });
    expect((await anon.get('/api/holidays')).status()).toBe(401);
    await anon.dispose();
  });
});
