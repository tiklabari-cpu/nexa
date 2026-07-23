import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite.
 *
 * Covers the one path the unit and integration suites structurally cannot: a
 * real browser, a real cross-origin iframe, and the agent app and widget
 * talking to each other through the API. Every defect these caught so far was
 * invisible below this level — a sandboxed iframe sending `Origin: null`, a
 * menu panel that was hidden only by paint order.
 *
 * The widget host page is served from `acme-bikes.localhost` while the widget
 * itself is on `localhost`. That is not incidental: the loader refuses to run
 * same-origin, because a same-origin iframe is not an isolation boundary. RFC
 * 6761 reserves the whole `.localhost` TLD for loopback, so both resolve to this
 * machine with no hosts-file entry.
 */

const API = 'http://localhost:4000';
const WEB = 'http://localhost:5173';
const WIDGET = 'http://localhost:5174';
/** Same server as WIDGET, different origin — this is the "customer's website". */
export const HOST_PAGE = 'http://acme-bikes.localhost:5174';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  // The suite shares one database and one seed, so parallel files would clobber
  // each other's conversations. Correctness over wall-clock here.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'pnpm --filter @nexa/api dev',
      url: `${API}/api/v1/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @nexa/rtm dev',
      url: 'http://localhost:4001/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @nexa/web dev',
      url: WEB,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @nexa/widget dev',
      url: `${WIDGET}/demo.html`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
