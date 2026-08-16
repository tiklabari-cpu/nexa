/**
 * The module-parity matrix (FR-MOD-13.7 · 13.7-k).
 *
 * FR-MOD-13.7's acceptance criterion asks for "full module parity", and §C-A28
 * read that as *screen* parity over the four surfaces the criterion names by
 * name — Inbox, AI, CRM, Reports — with Settings, Billing, Playbook and Team
 * explicitly outside the phone. Ten windows (`13.7-a`…`-j`) each closed one
 * piece of that and each said so in its own handoff note. This file is the one
 * place the claim is *counted* rather than narrated, and the only place a
 * reader can see the whole shape at once: what is covered, what was left out on
 * purpose, and what is still owed.
 *
 * Everything below is derived from artifacts rather than restated from them.
 * The matrix names a surface; the test then goes and looks — at the screen file
 * on disk, at the route in the navigator that mounts it, at the request literal
 * in its `api.ts`, at the entry in the contract registry, and at
 * `openapi.yaml` itself for the endpoints the phone is supposed *not* to call.
 * A hand-written list that agreed with itself would prove nothing; the point of
 * a parity matrix is that it can be wrong, and that it fails when it is.
 *
 * Three failures are designed in, because they are the three ways this claim
 * decays: a screen deleted or a route unmounted (surface no longer covered), a
 * new endpoint called from the phone (something arrived that nobody classified),
 * and an out-of-scope module quietly wired up (the narrowing was abandoned
 * without anybody revisiting §C-A28). Adding a surface is deliberately not
 * free — the matrix has to be edited for the suite to pass again.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT_TABS, type RootTabName } from '../app/navigation';
import { MOBILE_ENDPOINTS, type MobileEndpointKey } from '../lib/contract';

/**
 * `process.cwd()` is this package's root however the suite is started (`pnpm
 * test`, turbo, or jest directly), so both the walk below and the reach across
 * to `packages/contract` are fixed paths — the same technique `tokens.test.ts`
 * uses to read the web app's stylesheet.
 */
const SRC = join(process.cwd(), 'src');
const OPENAPI = join(process.cwd(), '..', '..', 'packages', 'contract', 'openapi', 'openapi.yaml');

/** Production source only: a test naming an endpoint is not the app calling it. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (entry.name.includes('.test.')) return [];
    return [path];
  });
}

const SOURCES = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/**
 * Every endpoint the app actually asks for, read off the call sites.
 *
 * The literals are what `ApiClient.request` is handed, and they are checked
 * against the generated contract by `tsc` (see `lib/contract.ts`), so a path
 * matched here is a path that exists. Type declarations
 * (`ContractResponseBody<'/customers', 'get'>`) are deliberately not matched:
 * naming a shape is not making a request.
 */
const REQUESTED: ReadonlySet<string> = new Set(
  SOURCES.flatMap(({ text }) =>
    [...text.matchAll(/\.request\(\s*'(?:get|post|put|patch|delete)',\s*'([^']+)'/g)].map(
      (match) => match[1]!,
    ),
  ),
);

/** Every path the OpenAPI document declares — the whole product, for comparison. */
const CONTRACT_PATHS: readonly string[] = [
  ...new Set(
    [...readFileSync(OPENAPI, 'utf8').matchAll(/^ {2}(\/[^\s:]*):\s*$/gm)].map(
      (match) => match[1]!,
    ),
  ),
];

/** The route names the navigator mounts, across every stack. */
const MOUNTED_ROUTES: readonly string[] = SOURCES.filter(({ path }) =>
  path.includes(join('app', 'stacks')),
).flatMap(({ text }) => [...text.matchAll(/name="(\w+)"/g)].map((match) => match[1]!));

const NAVIGATION_SOURCE = readFileSync(join(SRC, 'app', 'navigation.ts'), 'utf8');

// --- The matrix -------------------------------------------------------------

interface Surface {
  /** The word FR-MOD-13.7's acceptance criterion uses. */
  criterion: 'Inbox' | 'AI' | 'CRM' | 'Reports';
  /** Which tab it is reached through. */
  tab: RootTabName;
  /** Its directory under `src/features/`. */
  feature: string;
  /** Screen components that must exist there. */
  screens: string[];
  /** Routes that must be mounted for it to be reachable. */
  routes: string[];
  /** Endpoints its `api.ts` requests. */
  endpoints: string[];
  /** Its entries in the contract registry `13.7-a` set up for this matrix. */
  registry: MobileEndpointKey[];
  /** What the web console has here that the phone deliberately does not. */
  narrowedTo: string;
}

const MATRIX: readonly Surface[] = [
  {
    criterion: 'Inbox',
    tab: 'Inbox',
    feature: 'inbox',
    screens: ['ChatListScreen.tsx', 'ChatScreen.tsx', 'Composer.tsx', 'Transcript.tsx'],
    routes: ['InboxHome', 'ChatDetail'],
    endpoints: ['/chats', '/chats/{chatId}/events'],
    registry: ['chats'],
    narrowedTo:
      'list + transcript + composer over live RTM; no transfer, tagging, ticket or supervision surface (13.7-f)',
  },
  {
    criterion: 'AI',
    tab: 'Inbox',
    feature: 'copilot',
    screens: ['CopilotScreen.tsx'],
    routes: ['ChatCopilot'],
    endpoints: ['/copilot/chats/{chatId}/summary', '/copilot/chats/{chatId}/reply'],
    registry: ['copilotChatSummary', 'copilotChatReply'],
    narrowedTo:
      'summary + suggested reply, consume-only; no rewrite, no BI command, no knowledge management (13.7-i)',
  },
  {
    criterion: 'CRM',
    tab: 'Customers',
    feature: 'customers',
    screens: ['CustomerListScreen.tsx', 'CustomerDetailScreen.tsx'],
    routes: ['CustomersHome', 'CustomerDetail'],
    endpoints: ['/customers', '/customers/{customerId}'],
    registry: ['customers'],
    narrowedTo:
      'read-only directory + identity card; no editing, ban, custom fields, visit history or visitor board (13.7-g)',
  },
  {
    criterion: 'Reports',
    tab: 'Reports',
    feature: 'reports',
    screens: ['ReportsScreen.tsx'],
    routes: ['ReportsHome'],
    endpoints: ['/reports/overview'],
    registry: ['reportsOverview'],
    narrowedTo:
      'Overview KPIs at the server default window; no range picker, report groups, export or scheduling (13.7-h)',
  },
];

/**
 * Endpoints the phone calls that belong to no FR-MOD-13.7 surface.
 *
 * Both entries are load-bearing rather than leftovers, and both are here so
 * that the "classify everything" assertion below has somewhere honest to put
 * them instead of the matrix growing a fifth surface it does not have.
 */
const SUPPORTING: readonly { endpoints: string[]; why: string }[] = [
  {
    endpoints: ['/auth/login', '/auth/authorize', '/auth/token', '/auth/me', '/auth/revoke'],
    why: 'the session itself — the console’s own OAuth 2.1 + PKCE pair, no second way to mint a token (13.7-b)',
  },
  {
    endpoints: ['/agents/me/notification-preferences'],
    why: 'FR-MOD-08.2 asks for one preference set consistent across channels, so the phone reads and writes the same five (13.7-j)',
  },
];

/**
 * The four modules §C-A28 puts outside the phone.
 *
 * Each is stated as a predicate over contract paths, and each is checked twice:
 * that the contract really declares endpoints under it — otherwise "we do not
 * call it" would be a claim about nothing — and that no call site on the phone
 * reaches one.
 */
const OUT_OF_SCOPE: readonly { module: string; matches: (path: string) => boolean; why: string }[] =
  [
    {
      module: 'Settings (workspace administration)',
      // `/agents/me/notification-preferences` is the deliberate exception and is
      // classified under SUPPORTING; everything an administrator would open is here.
      matches: (path) =>
        ['/brands', '/webhooks', '/settings/', '/auth/personal-access-tokens'].some((prefix) =>
          path.startsWith(prefix),
        ),
      why: 'a console job on a laptop; the phone carries one settings screen and it is FR-MOD-08.2’s',
    },
    {
      module: 'Billing',
      matches: (path) => path.startsWith('/billing'),
      why: 'card and plan changes are not a thing this project does at all (CLAUDE.md limits)',
    },
    {
      module: 'Playbook / AI administration',
      matches: (path) => path.startsWith('/skills') || path.startsWith('/copilot/knowledge'),
      why: 'authoring a skill or a knowledge source is desk work; the phone only consumes what they produce',
    },
    {
      module: 'Team management',
      matches: (path) => path === '/agents' || path.startsWith('/agents/{') || path === '/groups',
      why: 'roles, schedules, suspensions and groups are owner/admin work with no mobile case',
    },
  ];

/**
 * What is still owed after every subtask is green — §D96's honesty record.
 *
 * These are assertions about the *current* state, so each of them fails the day
 * the debt is paid. That is the intent: paying it must come with revisiting this
 * matrix and the `13.7` row in `PLAN.md`, not with a quiet green suite.
 */
const OPEN_DEBTS = [
  'store publishing: the gate builds a JS bundle (`expo export`); no .ipa/.apk, no store submission (§D96)',
  'handset registration: `DeviceTokenLifecycle` ships with no provider and no transport, so the app never calls `/notifications/devices` — the server half (13.7-c/-d) is complete and tested without it',
] as const;

// --- The four surfaces ------------------------------------------------------

describe('module parity matrix — the surfaces FR-MOD-13.7 names', () => {
  it('counts four, and exactly the four the criterion lists', () => {
    expect(MATRIX.map((surface) => surface.criterion).sort()).toEqual([
      'AI',
      'CRM',
      'Inbox',
      'Reports',
    ]);
  });

  it.each(MATRIX)('$criterion — has screens on disk under features/$feature', (surface) => {
    const dir = join(SRC, 'features', surface.feature);
    expect(existsSync(dir)).toBe(true);
    for (const screen of surface.screens) {
      expect(existsSync(join(dir, screen))).toBe(true);
    }
  });

  it.each(MATRIX)('$criterion — is reachable: its routes are typed and mounted', (surface) => {
    for (const route of surface.routes) {
      // Declared in the param lists…
      expect(NAVIGATION_SOURCE).toContain(`${route}:`);
      // …and actually handed to a `Stack.Screen`. A route that only exists in
      // the type is a screen nobody can open.
      expect(MOUNTED_ROUTES).toContain(route);
    }
    expect(ROOT_TABS).toContain(surface.tab);
  });

  it.each(MATRIX)('$criterion — requests exactly the endpoints the matrix claims', (surface) => {
    const api = readFileSync(join(SRC, 'features', surface.feature, 'api.ts'), 'utf8');
    const called = [...api.matchAll(/\.request\(\s*'(?:get|post|put|patch|delete)',\s*'([^']+)'/g)]
      .map((match) => match[1]!)
      .sort();
    expect([...new Set(called)]).toEqual([...surface.endpoints].sort());
  });

  it.each(MATRIX)('$criterion — says what it narrowed, so parity is not overclaimed', (surface) => {
    // Every surface on the phone is smaller than its console counterpart. The
    // matrix is only honest if it carries that sentence next to the tick.
    expect(surface.narrowedTo.length).toBeGreaterThan(0);
  });

  it('anchors the surfaces in the contract registry, with nothing floating', () => {
    // `MOBILE_ENDPOINTS` was created by `13.7-a` for this matrix to stand on:
    // each entry is verified by `tsc` against the generated contract, so a spec
    // rename cannot leave a surface pointing at a path that no longer exists.
    const claimed = MATRIX.flatMap((surface) => surface.registry).sort();
    const registered = (Object.keys(MOBILE_ENDPOINTS) as MobileEndpointKey[])
      .filter((key) => key !== 'health')
      .sort();
    expect(claimed).toEqual(registered);

    for (const surface of MATRIX) {
      for (const key of surface.registry) {
        expect(surface.endpoints).toContain(MOBILE_ENDPOINTS[key]);
      }
    }
  });
});

// --- What the phone calls, and nothing more ---------------------------------

describe('module parity matrix — every request is accounted for', () => {
  it('classifies each endpoint the app calls as a surface or as support', () => {
    const classified = [
      ...MATRIX.flatMap((surface) => surface.endpoints),
      ...SUPPORTING.flatMap((entry) => entry.endpoints),
    ].sort();

    // Exact equality in both directions, which is the whole point: an endpoint
    // added to the app without a row here fails, and a row here that nothing
    // calls fails too.
    expect([...REQUESTED].sort()).toEqual(classified);
  });

  it('calls only paths the published contract declares', () => {
    for (const path of REQUESTED) {
      expect(CONTRACT_PATHS).toContain(path);
    }
  });

  it('says why each supporting endpoint is not a fifth surface', () => {
    for (const entry of SUPPORTING) {
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });
});

// --- What §C-A28 leaves out -------------------------------------------------

describe('module parity matrix — the modules §C-A28 puts out of scope', () => {
  it('counts four, the four the assumption names', () => {
    expect(OUT_OF_SCOPE).toHaveLength(4);
    expect(OUT_OF_SCOPE.map((entry) => entry.module.split(' ')[0])).toEqual([
      'Settings',
      'Billing',
      'Playbook',
      'Team',
    ]);
  });

  it.each(OUT_OF_SCOPE)('$module — the product has it, and the phone never asks', (entry) => {
    // Non-vacuity first: an out-of-scope claim about endpoints that do not
    // exist would pass forever while proving nothing.
    const declared = CONTRACT_PATHS.filter(entry.matches);
    expect(declared.length).toBeGreaterThan(0);

    expect([...REQUESTED].filter(entry.matches)).toEqual([]);
  });

  it('ships no feature module the matrix does not account for', () => {
    const shipped = readdirSync(join(SRC, 'features'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // `notifications` is the FR-MOD-08.2 screen (13.7-j) — the one Settings
    // surface that is in scope, and the reason the fourth tab exists at all.
    expect(shipped).toEqual([...MATRIX.map((surface) => surface.feature), 'notifications'].sort());
  });

  it('names four tabs, the fourth of which is FR-MOD-08.2 rather than Settings-the-module', () => {
    expect([...ROOT_TABS]).toEqual(['Inbox', 'Customers', 'Reports', 'Settings']);
    // Whatever the tab is called, what it mounts is the notification
    // preferences screen and nothing else.
    const settingsStack = readFileSync(join(SRC, 'app', 'stacks', 'SettingsStack.tsx'), 'utf8');
    expect(settingsStack).toContain('features/notifications/NotificationsScreen');
    expect([...settingsStack.matchAll(/name="(\w+)"/g)]).toHaveLength(1);
  });
});

// --- The debt this matrix refuses to hide -----------------------------------

describe('module parity matrix — what is still owed', () => {
  it('does not register the handset itself — the server half stands alone', () => {
    // `13.7-b` built the ordering (revoke before register on an account switch)
    // and injected the transport because `13.7-c`'s endpoints did not exist
    // yet; they do now, and nothing wired them together. Recorded rather than
    // fixed here because wiring it needs `expo-notifications` and a permission
    // prompt — new dependencies, not verification. When it lands, this
    // assertion is the thing that says so.
    expect([...REQUESTED]).not.toContain('/notifications/devices');
    const deviceToken = readFileSync(join(SRC, 'auth', 'device-token.ts'), 'utf8');
    expect(deviceToken).toContain('noDeviceToken');
  });

  it('builds a JS bundle, not a store artifact (§D96)', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['build']).toContain('expo export');
    // The narrowing that makes the `13.7` requirement row `◐` rather than `✅`:
    // no native toolchain step, so no `.ipa`/`.apk` and no submission.
    expect(Object.values(manifest.scripts).join(' ')).not.toMatch(
      /eas |prebuild|run:ios|run:android/,
    );
  });

  it('counts the whole matrix in one place', () => {
    expect({
      surfacesCovered: MATRIX.length,
      modulesOutOfScope: OUT_OF_SCOPE.length,
      endpointsCalled: REQUESTED.size,
      contractEndpoints: CONTRACT_PATHS.length,
      openDebts: OPEN_DEBTS.length,
    }).toEqual({
      surfacesCovered: 4,
      modulesOutOfScope: 4,
      endpointsCalled: 13,
      // Not a target — a denominator. The phone reaching 15 of the product's
      // paths is what "screen parity, not endpoint parity" (§C-A28) costs, and
      // the number moving is a prompt to re-read this matrix rather than a failure.
      contractEndpoints: 183,
      openDebts: 2,
    });
  });
});
