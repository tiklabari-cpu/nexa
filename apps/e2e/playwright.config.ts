import { fileURLToPath } from 'node:url';
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
/** The mail server the API sends to, and the mailbox the tests read (tm 255.4 · `tests/mailbox.ts`). */
const MOCK_SMTP_PORT = 4625;
const MOCK_SMTP_MAILBOX = 'http://127.0.0.1:4626';
/**
 * The test CA that signed the stand-in's certificate. Handed to the API process
 * the only way a trust anchor can be without relaxing verification — which the
 * carrier has no switch for (§D178).
 */
const SMTP_TEST_CA = fileURLToPath(
  new URL('../api/test/helpers/smtp-test-ca.crt', import.meta.url),
);
/** Same server as WIDGET, different origin — this is the "customer's website". */
export const HOST_PAGE = 'http://acme-bikes.localhost:5174';

export default defineConfig({
  testDir: './tests',
  // The public pilot's spec needs an API started with `PILOT_MODE=true`, which
  // this suite's servers are not (and, reused locally, cannot be made to be).
  // It runs on its own stack: `playwright.pilot.config.ts`, `pnpm test:e2e:pilot`.
  // The same holds for the minute-long access token `session-refresh.spec.ts`
  // waits out (tm 259.1): `playwright.session.config.ts`, `pnpm test:e2e:session`.
  testIgnore: ['**/pilot-mode.spec.ts', '**/session-refresh.spec.ts'],
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
    // No video, because a video turns a stalled clock into teardown work (tm 251).
    // The recorder stamps frames with wall-clock time and fills every gap with
    // copies of the last frame at 25 fps, and closing the context waits until
    // ffmpeg has encoded all of them. The laptop hibernated on a critical battery
    // for 20.6 minutes in the middle of a run; on wake that was ~30,900 frames at
    // the ~280/s this machine encodes, so the red test's own teardown overran its
    // 45 s slot and the file sat at 21.6 minutes. Freezing the worker for 12
    // minutes reproduces both lines of that failure exactly, and with video off
    // the teardown is immediate. Nothing was lost by it: the retained trace
    // already carries the screencast, DOM snapshots and network log, and in that
    // failure the video never got written anyway, because the teardown timed out
    // first. A freeze is reported as one, next to the red it causes, by the
    // `hostFreezeWatch` fixture in `tests/fixtures.ts`.
    video: 'off',
    actionTimeout: 10_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Before the API, so the first mail it sends has somewhere to go. See
      // `apps/api/scripts/mock-smtp-server.ts`.
      command: 'pnpm --filter @siyahtus/api mock-smtp',
      url: `${MOCK_SMTP_MAILBOX}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @siyahtus/api dev',
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
      //
      // The per-agent budget (ADR-07, `RATE_LIMIT_AGENT_PER_MIN`) is raised for
      // the same reason as the anonymous one above: `nfr-p4-fps.spec.ts` (tm 240)
      // chains ~210 `GET /tickets` requests back to back to load its 10,500-row
      // fixture, which alone is past the 180/min production default — measured,
      // it flips the grid into its error empty-state mid-chain (`tickets.isError`)
      // once the limiter starts returning 429. The limiter's own behaviour is
      // covered by `apps/api/test/integration`, not here.
      //
      // And the real mail carrier (tm 255.4). Every invitation, reset and notice
      // this suite causes goes out over SMTP — STARTTLS, AUTH, the certificate
      // verified — to the stand-in above, and the tests read it back from there.
      // The credentials are the stand-in's fake ones, not anybody's; the pilot's
      // live only in an operator's `.env`, which these override.
      //
      // And the sign-up limit and the daily mail caps (tm 257.14). The suite
      // signs up a fresh owner in spec after spec from one address, past the
      // hourly default of 10; and it runs against the one seeded database,
      // where the day's mail count is never emptied, so two or three full runs
      // in a UTC day would reach the caps a single run stays under. Both are
      // proven in `apps/api/test/integration`, not here.
      //
      // And the deterministic AI stubs (tm 257.5). Specs assert on the stub's
      // own words — `inbox-archive-summary.spec.ts` reads the visitor's question
      // back out of the Copilot summary — so an operator's `.env` naming a real
      // model must not reach this server. Locally a reused dev API still reads
      // the root `.env`, which therefore stays on `mock` too.
      env: {
        ...process.env,
        LLM_PROVIDER: 'mock',
        EMBEDDING_PROVIDER: 'mock',
        RATE_LIMIT_ANON_PER_MIN: '2000',
        RATE_LIMIT_AGENT_PER_MIN: '5000',
        RATE_LIMIT_SIGNUP_PER_HOUR: '10000',
        MAIL_DAILY_PER_WORKSPACE: '1000000',
        MAIL_DAILY_EXTERNAL_PER_WORKSPACE: '1000000',
        MAIL_DAILY_GLOBAL: '1000000',
        SCHEDULER_ENABLED: 'false',
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(MOCK_SMTP_PORT),
        SMTP_SECURE: 'false',
        SMTP_USERNAME: 'info@nolnk.test',
        SMTP_PASSWORD: 'fake-smtp-password-not-a-secret',
        SMTP_FROM: 'info@nolnk.test',
        NODE_EXTRA_CA_CERTS: SMTP_TEST_CA,
      },
    },
    {
      command: 'pnpm --filter @siyahtus/rtm dev',
      url: 'http://localhost:4001/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @siyahtus/web dev',
      url: WEB,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @siyahtus/widget dev',
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
      command: 'pnpm --filter @siyahtus/api mock-idp',
      url: `${MOCK_IDP}/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
