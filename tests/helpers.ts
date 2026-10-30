import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getSingaporeParts } from '../lib/timezone';

let counter = 0;

/** A username unique to this test run so tests never share data. */
export function uniqueUsername(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${process.pid}-${++counter}`;
}

/** `datetime-local` value (Singapore wall clock) `minutes` from now. */
export function sgDatetimeLocal(minutesFromNow: number): string {
  const p = getSingaporeParts(new Date(Date.now() + minutesFromNow * 60_000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO string `minutes` from now. */
export function isoFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export class TodoHelpers {
  constructor(readonly page: Page) {}

  get request(): APIRequestContext {
    return this.page.request;
  }

  /** Registers a fresh user with a virtual passkey and lands on the app. */
  async login(username = uniqueUsername()): Promise<string> {
    await addVirtualAuthenticator(this.page);
    await registerViaUI(this.page, username);
    await expect(this.page.getByTestId('section-pending')).toBeVisible();
    return username;
  }

  item(title: string) {
    return this.page.getByTestId('todo-item').filter({ hasText: title });
  }

  section(name: 'overdue' | 'pending' | 'completed') {
    return this.page.getByTestId(`section-${name}`);
  }

  async createTodo(title: string, opts: { due?: string; priority?: 'high' | 'medium' | 'low' } = {}) {
    await this.page.getByLabel('Todo title').fill(title);
    if (opts.due) await this.page.getByLabel('Due date', { exact: true }).fill(opts.due);
    if (opts.priority) await this.page.getByLabel('Priority', { exact: true }).selectOption(opts.priority);
    await this.page.getByRole('button', { name: 'Add', exact: true }).click();
  }

  /** Expands the todo's subtask panel (if collapsed) and adds a subtask through the UI. */
  async addSubtask(todoTitle: string, subtaskTitle: string) {
    const item = this.item(todoTitle);
    const panel = item.getByTestId('subtask-panel');
    const toggle = item.getByRole('button', { name: '▶ Subtasks' });
    // Wait for the row to render, then open the panel if it is collapsed.
    await expect(toggle.or(item.getByRole('button', { name: '▼ Subtasks' }))).toBeVisible();
    if (!(await panel.isVisible())) await toggle.click();
    await item.getByLabel('New subtask').fill(subtaskTitle);
    await item.getByLabel('New subtask').press('Enter');
    // Enabled checkbox = saved on the server (optimistic rows stay disabled until then).
    await expect(item.getByTestId('subtask-item').filter({ hasText: subtaskTitle }).getByRole('checkbox')).toBeEnabled();
  }

  /** Creates a tag through the Manage Tags modal and closes it. */
  async createTag(name: string, color?: string) {
    await this.page.getByRole('button', { name: '+ Manage Tags' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Manage tags' });
    await dialog.getByLabel('New tag name').fill(name);
    if (color) await dialog.getByLabel('New tag color hex').fill(color);
    await dialog.getByRole('button', { name: 'Create Tag' }).click();
    await expect(dialog.getByTestId('tag-row').filter({ hasText: name })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
  }

  /** Creates a tag through the API. */
  async apiCreateTag(name: string, color?: string) {
    const res = await this.request.post('/api/tags', { data: { name, color } });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }

  /** Creates a todo through the API (faster setup). */
  async apiCreateTodo(data: Record<string, unknown>) {
    const res = await this.request.post('/api/todos', { data });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }
}

/** Attaches a Chromium virtual authenticator (passkey device) to the page. */
export async function addVirtualAuthenticator(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

export async function registerViaUI(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

export async function loginViaUI(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

/** A fresh, signed-in browser context; its request object carries the session cookie. */
export async function signedInContext(browser: Browser, prefix = 'user'): Promise<{ context: BrowserContext; page: Page; username: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = uniqueUsername(prefix);
  await addVirtualAuthenticator(page);
  await registerViaUI(page, username);
  return { context, page, username };
}
