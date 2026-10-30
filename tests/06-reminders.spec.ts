import { test, expect, type Page } from '@playwright/test';
import { TodoHelpers, isoFromNow, sgDatetimeLocal } from './helpers';

/** Replaces window.Notification with a recorder; permission starts as `initial`. */
async function stubNotifications(page: Page, initial: NotificationPermission = 'default') {
  await page.addInitScript((initialPermission) => {
    const shown: { title: string; tag?: string }[] = [];
    (window as unknown as { __notifications: typeof shown }).__notifications = shown;
    class FakeNotification {
      static permission: NotificationPermission = initialPermission;
      static async requestPermission() {
        FakeNotification.permission = 'granted';
        return 'granted' as NotificationPermission;
      }
      constructor(title: string, opts?: NotificationOptions) {
        shown.push({ title, tag: opts?.tag });
      }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
  }, initial);
}

const shown = (page: Page) =>
  page.evaluate(() => (window as unknown as { __notifications: { title: string; tag?: string }[] }).__notifications);

test.describe('Reminders & notifications (PRP 04)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
  });

  test('Enable Notifications asks for permission and turns green', async ({ page }) => {
    await stubNotifications(page);
    await h.login();
    await page.getByRole('button', { name: '🔔 Enable Notifications' }).click();
    await expect(page.getByTestId('notifications-on')).toHaveText('🔔 Notifications On');
  });

  test('reminder dropdown: 7 presets + None, disabled until a due date is set', async ({ page }) => {
    await h.login();
    const select = page.getByLabel('Reminder', { exact: true });
    await expect(select).toBeDisabled();
    await page.getByLabel('Due date', { exact: true }).fill(sgDatetimeLocal(180));
    await expect(select).toBeEnabled();
    await expect(select.locator('option')).toHaveText([
      'No reminder',
      '🔔 15m before',
      '🔔 30m before',
      '🔔 1h before',
      '🔔 2h before',
      '🔔 1d before',
      '🔔 2d before',
      '🔔 1w before',
    ]);

    await page.getByLabel('Todo title').fill('Call bank');
    await select.selectOption('60');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(h.item('Call bank').getByTestId('reminder-badge')).toHaveText('🔔1h');
  });

  test('badge abbreviation for every preset', async ({ page }) => {
    await h.login();
    const labels: Record<number, string> = { 15: '15m', 30: '30m', 60: '1h', 120: '2h', 1440: '1d', 2880: '2d', 10080: '1w' };
    for (const minutes of Object.keys(labels)) {
      await h.apiCreateTodo({ title: `r${minutes}`, due_date: isoFromNow(20_000), reminder_minutes: Number(minutes) });
    }
    await page.reload();
    for (const [minutes, label] of Object.entries(labels)) {
      await expect(h.item(`r${minutes}`).getByTestId('reminder-badge')).toHaveText(`🔔${label}`);
    }
  });

  test('a due reminder fires exactly once across polls', async ({ page }) => {
    await stubNotifications(page, 'granted');
    await page.clock.install();
    await h.login();
    await h.apiCreateTodo({ title: 'Pay rent', due_date: isoFromNow(10), reminder_minutes: 15 });
    await h.apiCreateTodo({ title: 'Not yet', due_date: isoFromNow(600), reminder_minutes: 15 });
    await page.reload();

    await expect.poll(() => shown(page)).toHaveLength(1);
    expect((await shown(page))[0]).toMatchObject({ title: 'Reminder: Pay rent' });

    // Two more 30s polling intervals: no repeat.
    await page.clock.fastForward('00:30');
    await page.clock.fastForward('00:30');
    await page.waitForTimeout(500);
    expect(await shown(page)).toHaveLength(1);
  });

  test('check endpoint returns only open, un-notified windows; editing re-arms', async ({ page }) => {
    await h.login();
    const open = await h.apiCreateTodo({ title: 'Open', due_date: isoFromNow(10), reminder_minutes: 15 });
    await h.apiCreateTodo({ title: 'Later', due_date: isoFromNow(120), reminder_minutes: 30 });
    await h.apiCreateTodo({ title: 'No reminder', due_date: isoFromNow(5) });

    const check = async () => ((await (await page.request.get('/api/notifications/check')).json()).data as { title: string }[]).map((t) => t.title);
    expect(await check()).toEqual(['Open']);

    await page.request.put(`/api/todos/${open.id}`, { data: { last_notification_sent: new Date().toISOString() } });
    expect(await check()).toEqual([]);

    // Changing the reminder timing clears last_notification_sent.
    const res = await (await page.request.put(`/api/todos/${open.id}`, { data: { reminder_minutes: 30 } })).json();
    expect(res.last_notification_sent).toBeNull();
    expect(await check()).toEqual(['Open']);

    // Completed todos never remind.
    await page.request.put(`/api/todos/${open.id}`, { data: { completed: true } });
    expect(await check()).toEqual([]);
  });

  test('claim endpoint is exactly-once even when two tabs race', async ({ page }) => {
    await h.login();
    const todo = await h.apiCreateTodo({ title: 'Race', due_date: isoFromNow(10), reminder_minutes: 15 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => page.request.post(`/api/notifications/${todo.id}/claim`).then((r) => r.json()))
    );
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const later = await h.apiCreateTodo({ title: 'Not open', due_date: isoFromNow(600), reminder_minutes: 15 });
    expect((await (await page.request.post(`/api/notifications/${later.id}/claim`)).json()).claimed).toBe(false);
  });

  test('moving the due date clears last_notification_sent', async ({ page }) => {
    await h.login();
    const todo = await h.apiCreateTodo({ title: 'Move me', due_date: isoFromNow(10), reminder_minutes: 15 });
    await page.request.put(`/api/todos/${todo.id}`, { data: { last_notification_sent: new Date().toISOString() } });
    const moved = await (await page.request.put(`/api/todos/${todo.id}`, { data: { due_date: isoFromNow(20) } })).json();
    expect(moved.last_notification_sent).toBeNull();
  });

  test('API validates reminder presets and requires a due date', async ({ page }) => {
    await h.login();
    expect((await page.request.post('/api/todos', { data: { title: 'x', reminder_minutes: 15 } })).status()).toBe(400);
    expect(
      (await page.request.post('/api/todos', { data: { title: 'x', reminder_minutes: 45, due_date: isoFromNow(60) } })).status()
    ).toBe(400);
    const todo = await h.apiCreateTodo({ title: 'Has reminder', due_date: isoFromNow(60), reminder_minutes: 30 });
    // Clearing the due date drops the reminder too.
    const cleared = await (await page.request.put(`/api/todos/${todo.id}`, { data: { due_date: null } })).json();
    expect(cleared.reminder_minutes).toBeNull();
  });

  test('recurring next instance keeps the reminder and starts un-notified', async ({ page }) => {
    await h.login();
    const todo = await h.apiCreateTodo({
      title: 'Weekly sync',
      due_date: isoFromNow(10),
      reminder_minutes: 15,
      is_recurring: true,
      recurrence_pattern: 'weekly',
    });
    await page.request.put(`/api/todos/${todo.id}`, { data: { last_notification_sent: new Date().toISOString() } });
    const res = await (await page.request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).json();
    expect(res.next_instance).toMatchObject({ reminder_minutes: 15, last_notification_sent: null });
  });
});
