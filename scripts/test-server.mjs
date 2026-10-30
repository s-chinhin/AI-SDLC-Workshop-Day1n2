// Builds and starts a production server against a fresh, throwaway SQLite file for
// Playwright. A production build avoids dev-mode on-demand compilation stalling under
// parallel tests, and doubles as a `next build` check.
import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const dbPath = 'test.db';
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

const port = process.env.PORT ?? '3100';
const env = {
  ...process.env,
  DATABASE_PATH: dbPath,
  NEXT_DIST_DIR: '.next-test',
  JWT_SECRET: 'playwright-test-secret',
  // Tests talk to http://localhost, so the session cookie can't be Secure-only.
  COOKIE_SECURE: 'false',
};

for (const step of ['npx next build', 'npx tsx scripts/seed-holidays.ts']) {
  const result = spawnSync(step, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const child = spawn(`npx next start --port ${port}`, { stdio: 'inherit', shell: true, env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
