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
/** The stand-in identity provider a federated sign-in is redirected to (S11-i). */
const MOCK_IDP = 'http://127.0.0.1:4599';
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
      // The whole suite shares one IP, so every widget-token mint, sign-in and
      // signup lands in a single anonymous bucket. The production default (30/min)
      // is deliberately tight; the signup-driven onboarding flow pushed a
      // full-suite run past even a raised local limit. Give the test server
      // ample headroom so a 429 never masquerades as a product failure — the
      // limiter itself is covered by the integration suite, not here.
      //
      // And no background sweeps. Every test in this suite asserts against one
      // shared, seeded workspace, so a sweep is a second writer nobody in the
      // test declared: the SLA pass marks *every* overdue thread the moment a
      // target is saved — not only the conversation the test just created — and
      // the idle-chat pass would close conversations a test is still holding
      // open. Measured: with the sweeps on (their default outside tests), the
      // 11.5-d SLA test read 3 breaches where it created 1, because the sweep
      // had also marked two threads left behind by earlier files. That is
      // correct product behaviour and a broken fixture at the same time.
      // The scheduler is proven where it can be proven deterministically —
      // `apps/api/test/integration/scheduler-e2e.test.ts` boots real servers on
      // 200 ms intervals against its own isolated database and asserts each
      // sweep's actual effect.
      env: { ...process.env, RATE_LIMIT_ANON_PER_MIN: '2000', SCHEDULER_ENABLED: 'false' },
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
    {
      // A SAML identity provider the browser can actually be redirected to
      // (NFR-S11 · S11-i). Loopback only, and the one address the SSO URL
      // validation lets a connection use without TLS — see
      // `apps/api/scripts/mock-idp-server.ts`.
      command: 'pnpm --filter @nexa/api mock-idp',
      url: `${MOCK_IDP}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
