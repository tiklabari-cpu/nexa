import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { E2E_SHARD, PORTS, USUAL_PORTS } from './tests/stack-ports.js';

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

/** What the browser sees — on a private stack too, where its resolver maps it (below). */
const WEB = `http://localhost:${USUAL_PORTS.web}`;
/** Where the servers listen: the usual ports, or a shard's private ones (`tests/stack-ports.ts`). */
const API = `http://localhost:${PORTS.api}`;
const RTM = `http://localhost:${PORTS.rtm}`;
const WEB_SERVER = `http://localhost:${PORTS.web}`;
const WIDGET = `http://localhost:${PORTS.widget}`;
/** The stand-in identity provider a federated sign-in is redirected to (S11-i). */
const MOCK_IDP = `http://127.0.0.1:${PORTS.idp}`;
/** The mail server the API sends to, and the mailbox the tests read (tm 255.4 · `tests/mailbox.ts`). */
const MOCK_SMTP_PORT = PORTS.smtp;
const MOCK_SMTP_MAILBOX = `http://127.0.0.1:${PORTS.mailbox}`;
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

/**
 * A private stack (tm 260.1): `SIYAHTUS_E2E_SHARD` set, as `pnpm test:e2e:private`
 * and the sharded runner (`scripts/run-e2e-sharded.mjs`) set it. Built exactly
 * like the pilot's (`playwright.pilot.config.ts` explains each part):
 *
 *   - every server is started by this run (`reuseExistingServer: false`) on the
 *     shard's own ports, so a developer's dev stack is neither adopted nor
 *     disturbed, and several shards run beside each other;
 *   - Chromium's resolver maps the usual origins onto those ports, so the page
 *     still runs on `http://localhost:5173` and the widget's host pages on
 *     `*.localhost:5174`; Node-side calls read the ports from `stack-ports.ts`;
 *   - the database and Redis index are the run's own, from
 *     `apps/api/scripts/with-test-datastores.ts`; the global setup resets and
 *     seeds `DATABASE_URL`, so a private stack refuses any other database.
 *
 * Unset, nothing below changes: the usual ports, the shared seeded database,
 * and locally whatever dev servers already hold the ports.
 */
const PRIVATE = E2E_SHARD !== undefined;
if (PRIVATE && !/\/siyahtus_test_[0-9a-f]{12}(\?|$)/.test(process.env['DATABASE_URL'] ?? '')) {
  throw new Error(
    'SIYAHTUS_E2E_SHARD runs a private stack that resets and seeds DATABASE_URL, so it only ' +
      'runs against a private test database. Start it with `pnpm test:e2e:private`.',
  );
}
const REUSE = !PRIVATE && !process.env['CI'];
/** A private stack's results and Vite cache, apart from the usual ones and every other shard's. */
const SHARD_DIR = `shard-${E2E_SHARD ?? 'usual'}`;
const SHARD_ENV: Record<string, string> = PRIVATE
  ? { SIYAHTUS_VITE_CACHE_DIR: `node_modules/.vite-e2e-${SHARD_DIR}` }
  : {};

/**
 * How a server starts: its pnpm script on the usual stack, the same program
 * straight from `node` on a private one (tm 260.5).
 *
 * Memory is what limits how many private stacks a machine runs at once, and
 * the pnpm in front of each server was the largest single item: one ~110 MB
 * `pnpm` process per server, six per stack — measured with two stacks up, 16
 * of them held 1.8 GB while the host paged. A private stack also has no use
 * for `tsx watch`, whose watcher is a second process per server: nothing edits
 * the code under a running suite. The program and its working directory are
 * what the script would have run; only the wrappers go.
 */
function server(pkg: string, script: string, direct: string): { command: string; cwd: string } {
  return PRIVATE
    ? { command: `node ${direct}`, cwd: `../${pkg}` }
    : { command: `pnpm --filter @siyahtus/${pkg} ${script}`, cwd: '../..' };
}

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
  reporter: PRIVATE
    ? [
        [process.env['CI'] ? 'github' : 'list'],
        ['html', { open: 'never', outputFolder: `./playwright-report/${SHARD_DIR}` }],
        // Per-file durations, for the sharded runner's balancing (tm 260.2).
        ['json', { outputFile: `./test-results/${SHARD_DIR}.json` }],
      ]
    : process.env['CI']
      ? [['github'], ['html', { open: 'never' }]]
      : [['list'], ['html', { open: 'never' }]],
  ...(PRIVATE ? { outputDir: `./test-results/${SHARD_DIR}` } : {}),

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

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(PRIVATE
          ? {
              launchOptions: {
                args: [
                  '--host-resolver-rules=' +
                    [
                      `MAP localhost:${USUAL_PORTS.api} localhost:${PORTS.api}`,
                      `MAP localhost:${USUAL_PORTS.rtm} localhost:${PORTS.rtm}`,
                      `MAP localhost:${USUAL_PORTS.web} localhost:${PORTS.web}`,
                      `MAP localhost:${USUAL_PORTS.widget} localhost:${PORTS.widget}`,
                      `MAP *.localhost:${USUAL_PORTS.widget} localhost:${PORTS.widget}`,
                    ].join(', '),
                ],
              },
            }
          : {}),
      },
    },
  ],

  webServer: [
    {
      // Before the API, so the first mail it sends has somewhere to go. See
      // `apps/api/scripts/mock-smtp-server.ts`.
      ...server('api', 'mock-smtp', 'node_modules/tsx/dist/cli.mjs scripts/mock-smtp-server.ts'),
      url: `${MOCK_SMTP_MAILBOX}/health`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      env: {
        ...process.env,
        MOCK_SMTP_PORT: String(PORTS.smtp),
        MOCK_SMTP_HTTP_PORT: String(PORTS.mailbox),
      },
    },
    {
      ...server('api', 'dev', 'node_modules/tsx/dist/cli.mjs src/index.ts'),
      url: `${API}/api/v1/health`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
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
        API_PORT: String(PORTS.api),
      },
    },
    {
      ...server('rtm', 'dev', 'node_modules/tsx/dist/cli.mjs src/index.ts'),
      url: `${RTM}/health`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      env: { ...process.env, RTM_PORT: String(PORTS.rtm) },
    },
    {
      // On a private stack the panel's relative `/api/v1` goes through Vite's
      // proxy, which runs in Node and so would reach the usual api without
      // `API_BASE_URL`. `--strictPort`, so a taken port fails the start instead
      // of drifting onto the next shard's.
      ...server('web', 'dev', 'node_modules/vite/bin/vite.js --strictPort'),
      url: WEB_SERVER,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      env: {
        ...process.env,
        ...SHARD_ENV,
        WEB_PORT: String(PORTS.web),
        ...(PRIVATE ? { API_BASE_URL: API } : ({} as Record<string, string>)),
      },
    },
    {
      ...server('widget', 'dev', 'node_modules/vite/bin/vite.js --strictPort'),
      url: `${WIDGET}/demo.html`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      env: { ...process.env, ...SHARD_ENV, WIDGET_PORT: String(PORTS.widget) },
    },
    {
      // A SAML identity provider the browser can actually be redirected to
      // (NFR-S11 · S11-i). Loopback only, and the one address the SSO URL
      // validation lets a connection use without TLS — see
      // `apps/api/scripts/mock-idp-server.ts`.
      ...server('api', 'mock-idp', 'node_modules/tsx/dist/cli.mjs scripts/mock-idp-server.ts'),
      url: `${MOCK_IDP}/health`,
      reuseExistingServer: REUSE,
      timeout: 60_000,
      env: { ...process.env, MOCK_IDP_PORT: String(PORTS.idp) },
    },
  ],
});
