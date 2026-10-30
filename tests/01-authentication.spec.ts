import { test, expect, request as playwrightRequest } from '@playwright/test';
import { addVirtualAuthenticator, loginViaUI, registerViaUI, signedInContext, uniqueUsername } from './helpers';

test.describe('Authentication (PRP 11)', () => {
  test('signed-out visitors are redirected from / and /calendar to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('register sets a 7-day HTTP-only cookie and shows the app', async ({ page, context }) => {
    await addVirtualAuthenticator(page);
    const username = uniqueUsername();
    await registerViaUI(page, username);
    await expect(page.getByTestId('current-user')).toHaveText(username);

    const cookie = (await context.cookies()).find((c) => c.name === 'session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    const days = (cookie.expires * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const me = await page.request.get('/api/auth/me');
    expect(await me.json()).toMatchObject({ username });
  });

  test('session survives reload; /login redirects a signed-in user to /', async ({ page }) => {
    await addVirtualAuthenticator(page);
    await registerViaUI(page, uniqueUsername());
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });

  test('logout clears the session; login with the same passkey works and bumps the counter', async ({ page }) => {
    await addVirtualAuthenticator(page);
    const username = uniqueUsername();
    await registerViaUI(page, username);

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    expect((await page.request.get('/api/todos')).status()).toBe(401);

    await loginViaUI(page, username);
    await expect(page.getByTestId('current-user')).toHaveText(username);
  });

  test('duplicate username is rejected with 409 before a challenge is issued', async ({ page, baseURL }) => {
    await addVirtualAuthenticator(page);
    const username = uniqueUsername();
    await registerViaUI(page, username);

    const anon = await playwrightRequest.newContext({ baseURL });
    const res = await anon.post('/api/auth/register-options', { data: { username } });
    expect(res.status()).toBe(409);
    expect((await res.json()).challenge).toBeUndefined();
    await anon.dispose();
  });

  test('duplicate username shows an error on the login page', async ({ browser }) => {
    const { context, username } = await signedInContext(browser);
    await context.close();

    const other = await browser.newContext();
    const page = await other.newPage();
    await addVirtualAuthenticator(page);
    await page.goto('/login');
    await page.getByLabel('Username').fill(username);
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('Username already taken');
    await other.close();
  });

  test('login with an unknown username fails cleanly', async ({ page }) => {
    await addVirtualAuthenticator(page);
    await page.goto('/login');
    await page.getByLabel('Username').fill(uniqueUsername('ghost'));
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByTestId('login-error')).toHaveText('No passkey found for that username');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a passkey from another device cannot sign in as this user', async ({ browser }) => {
    const { context, username } = await signedInContext(browser);
    await context.close();

    // Different browser = different virtual authenticator with no credential for this user.
    const other = await browser.newContext();
    const page = await other.newPage();
    await addVirtualAuthenticator(page);
    await page.goto('/login');
    await page.getByLabel('Username').fill(username);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await other.close();
  });

  test('a second device can be added and either device can sign in', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const addDevice = async () =>
      (
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
          options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        })
      ).authenticatorId;

    // Detach a device but keep its credentials so it can be "plugged back in" later.
    const unplug = async (authenticatorId: string) => {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      return credentials;
    };
    const plugIn = async (credentials: Awaited<ReturnType<typeof unplug>>) => {
      const id = await addDevice();
      for (const credential of credentials) await cdp.send('WebAuthn.addCredential', { authenticatorId: id, credential });
      return id;
    };
    const signOutAndIn = async (username: string) => {
      await page.getByRole('button', { name: 'Logout' }).click();
      await loginViaUI(page, username);
      await expect(page.getByTestId('current-user')).toHaveText(username);
    };

    const username = uniqueUsername();
    const laptopCreds = await unplug(await (async () => {
      const id = await addDevice();
      await registerViaUI(page, username);
      return id;
    })());

    // Register the phone while only it is attached.
    const phone = await addDevice();
    await page.getByRole('button', { name: 'Add device' }).click();
    await expect(page.getByTestId('notice')).toContainText('Passkey added');
    const opts = await (await page.request.post('/api/auth/login-options', { data: { username } })).json();
    expect(opts.allowCredentials).toHaveLength(2);

    await signOutAndIn(username); // phone only
    const phoneCreds = await unplug(phone);
    expect(phoneCreds).toHaveLength(1);

    const laptop = await plugIn(laptopCreds);
    await signOutAndIn(username); // laptop only
    await unplug(laptop);
  });

  test('tampered session cookie is treated as signed out', async ({ page, context }) => {
    await addVirtualAuthenticator(page);
    await registerViaUI(page, uniqueUsername());
    const cookie = (await context.cookies()).find((c) => c.name === 'session')!;
    await context.addCookies([{ ...cookie, value: cookie.value.slice(0, -4) + 'AAAA' }]);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });
});
