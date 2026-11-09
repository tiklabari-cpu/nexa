import { defineConfig, devices } from '@playwright/test';
import { CSP_SMOKE_RESOLVER_RULES } from './tests/csp-smoke-stack.js';

/**
 * The production CSP in a real browser (tm 434): `tests/csp-smoke.spec.ts`
 * against the built images, served by their own nginx.
 *
 *     scripts/csp-smoke.sh
 *
 * That script builds and starts `docker-compose.full.yml` under a compose
 * project of its own, on ports of its own (`scripts/csp-smoke.compose.yml`),
 * runs this config, and removes the project again. The browser keeps the
 * addresses the bundles were built for, and Chromium's resolver maps them onto
 * those ports (`tests/csp-smoke-stack.ts`), so a running `pnpm dev` is no
 * obstacle. Against a stack that is already up, name its ports — for a demo
 * stack on the usual ones:
 *
 *     CSP_SMOKE_API_PORT=4000 CSP_SMOKE_RTM_PORT=4001 CSP_SMOKE_WEB_PORT=5173 \
 *       CSP_SMOKE_WIDGET_PORT=5174 pnpm --filter @siyahtus/e2e test:csp
 *
 * Unlike the main config this starts no server and has no global setup: the
 * main suite's setup resets and reseeds the database, and the stack measured
 * here is not its stack. The spec signs in as the seeded demo owner and adds
 * one visitor conversation, nothing else.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: 'csp-smoke.spec.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  // A refusal is deterministic; a retry would only hide a slow stack.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: './test-results/csp-smoke',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report/csp-smoke' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium-csp',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: [`--host-resolver-rules=${CSP_SMOKE_RESOLVER_RULES}`] },
      },
    },
  ],
});
