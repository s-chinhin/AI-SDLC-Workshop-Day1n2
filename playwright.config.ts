import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: `http://localhost:${PORT}/api/todos`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000, // includes `next build`
  },
});
