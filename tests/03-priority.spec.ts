import { test, expect, type Page } from '@playwright/test';
import { TodoHelpers, isoFromNow } from './helpers';

/** Titles in the Pending section, top to bottom. */
const pendingTitles = (page: Page) => page.getByTestId('section-pending').getByTestId('todo-item').locator('p');

test.describe('Priority system (PRP 02)', () => {
  let h: TodoHelpers;

  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('each priority level shows the right badge; default is Medium', async () => {
    await h.createTodo('Urgent thing', { priority: 'high' });
    await h.createTodo('Normal thing');
    await h.createTodo('Someday thing', { priority: 'low' });

    for (const [title, priority, label] of [
      ['Urgent thing', 'high', 'High'],
      ['Normal thing', 'medium', 'Medium'],
      ['Someday thing', 'low', 'Low'],
    ]) {
      const badge = h.item(title).getByTestId('priority-badge');
      await expect(badge).toHaveAttribute('data-priority', priority);
      await expect(badge).toHaveText(label);
    }
  });

  test('same due date sorts High → Medium → Low', async ({ page }) => {
    const due = isoFromNow(120);
    await h.apiCreateTodo({ title: 'L', priority: 'low', due_date: due });
    await h.apiCreateTodo({ title: 'H', priority: 'high', due_date: due });
    await h.apiCreateTodo({ title: 'M', priority: 'medium', due_date: due });
    await page.reload();
    await expect(pendingTitles(page)).toHaveText(['H', 'M', 'L']);
  });

  test('editing Low → High moves it above Medium/Low', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Medium one', priority: 'medium' });
    await h.apiCreateTodo({ title: 'Low one', priority: 'low' });
    await h.apiCreateTodo({ title: 'Promote me', priority: 'low' });
    await page.reload();
    await expect(pendingTitles(page)).toHaveText(['Medium one', 'Promote me', 'Low one']);

    await h.item('Promote me').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Edit priority').selectOption('high');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(pendingTitles(page)).toHaveText(['Promote me', 'Medium one', 'Low one']);
    await expect(h.item('Promote me').getByTestId('priority-badge')).toHaveText('High');
  });

  test('priority filter shows one level; All Priorities restores everything', async ({ page }) => {
    await h.apiCreateTodo({ title: 'A high', priority: 'high' });
    await h.apiCreateTodo({ title: 'A medium', priority: 'medium' });
    await h.apiCreateTodo({ title: 'A low', priority: 'low' });
    await page.reload();

    const filter = page.getByLabel('Filter by priority');
    await filter.selectOption('high');
    await expect(pendingTitles(page)).toHaveText(['A high']);
    await filter.selectOption('low');
    await expect(pendingTitles(page)).toHaveText(['A low']);
    await filter.selectOption('all');
    await expect(pendingTitles(page)).toHaveCount(3);
  });

  test('editing priority away from the active filter hides the todo immediately', async ({ page }) => {
    await h.apiCreateTodo({ title: 'Was high', priority: 'high' });
    await page.reload();
    await page.getByLabel('Filter by priority').selectOption('high');
    await h.item('Was high').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Edit priority').selectOption('low');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(h.item('Was high')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`badge text meets WCAG AA contrast in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const p of ['high', 'medium', 'low']) await h.apiCreateTodo({ title: `c-${p}`, priority: p });
      await page.reload();
      await expect(page.getByTestId('priority-badge')).toHaveCount(3);

      const ratios = await page.getByTestId('priority-badge').evaluateAll((badges) => {
        // Canvas normalizes any CSS color (incl. oklch) to sRGB bytes.
        const ctx = document.createElement('canvas').getContext('2d')!;
        const rgb = (css: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        };
        const lum = ([r, g, b]: number[]) => {
          const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        return badges.map((el) => {
          const s = getComputedStyle(el);
          const [a, b] = [lum(rgb(s.color)), lum(rgb(s.backgroundColor))].sort((x, y) => y - x);
          return { priority: el.getAttribute('data-priority'), ratio: (a + 0.05) / (b + 0.05) };
        });
      });

      expect(ratios).toHaveLength(3);
      for (const r of ratios) expect(r.ratio, `${r.priority} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('Priority API (PRP 02)', () => {
  let h: TodoHelpers;
  test.beforeEach(async ({ page }) => {
    h = new TodoHelpers(page);
    await h.login();
  });

  test('invalid priority on create → 400 and nothing written', async () => {
    for (const bad of ['urgent', 'HIGH', '', 3]) {
      const res = await h.request.post('/api/todos', { data: { title: `bad-${bad}`, priority: bad } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toContain('Invalid priority');
    }
    const list = await (await h.request.get('/api/todos')).json();
    expect(list).toHaveLength(0);
  });

  test('invalid or null priority on update → 400 and row unchanged', async () => {
    const todo = await h.apiCreateTodo({ title: 'Stable', priority: 'low' });
    for (const bad of ['urgent', null]) {
      const res = await h.request.put(`/api/todos/${todo.id}`, { data: { priority: bad } });
      expect(res.status()).toBe(400);
    }
    const after = await (await h.request.get(`/api/todos/${todo.id}`)).json();
    expect(after.priority).toBe('low');
  });

  test('GET ?priority= filters server-side', async () => {
    await h.apiCreateTodo({ title: 'x', priority: 'high' });
    await h.apiCreateTodo({ title: 'y', priority: 'low' });
    const list = await (await h.request.get('/api/todos?priority=high')).json();
    expect(list.map((t: { title: string }) => t.title)).toEqual(['x']);
    expect((await h.request.get('/api/todos?priority=urgent')).status()).toBe(400);
  });
});
