/**
 * The module-parity matrix (FR-MOD-13.7 · 13.7-k).
 *
 * FR-MOD-13.7's acceptance criterion asks for "full module parity", and §C-A28
 * read that as *screen* parity over the four surfaces the criterion names by
 * name — Inbox, AI, CRM, Reports — with Settings, Billing, Playbook and Team
 * explicitly outside the phone. Ten windows (`13.7-a`…`-j`) each closed one
 * piece of that and each said so in its own handoff note, and `13.7-l` came
 * back for the one this file caught still open. This file is the one place the
 * claim is *counted* rather than narrated, and the only place a reader can see
 * the whole shape at once: what is covered, what was left out on purpose, and
 * what is still owed.
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
 *
 * A fourth was added by `13.7-w`, and it is the one this file was blind to when
 * it shipped: every surface can be present, mounted and correct while the app
 * has no door. §D111 found exactly that — four ticks above, and a cold launch
 * that ended on a 401 with no sign-in screen to reach. `SHELL` is that row now,
 * and `journey.test.tsx` is where somebody walks it.
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

/**
 * The route names the navigator mounts, across every stack.
 *
 * `app/stacks/` holds the four tabs' stacks. The signed-out tree is not one of
 * them — `AuthStack` renders *instead of* the tab navigator (13.7-p), so it
 * lives beside the screens it mounts and has to be read from there. Both are
 * included, which is what keeps "typed but never mounted" a failure on either
 * side of the gate.
 */
const AUTH_STACK = join('features', 'auth', 'AuthStack.tsx');
const MOUNTED_ROUTES: readonly string[] = SOURCES.filter(
  ({ path }) => path.includes(join('app', 'stacks')) || path.endsWith(AUTH_STACK),
).flatMap(({ text }) => [...text.matchAll(/name="(\w+)"/g)].map((match) => match[1]!));

/** Endpoints requested from a subtree — the same read `REQUESTED` does, narrowed. */
function requestsUnder(prefixes: readonly string[]): string[] {
  const roots = prefixes.map((prefix) => join(SRC, prefix));
  return [
    ...new Set(
      SOURCES.filter(({ path }) => roots.some((root) => path.startsWith(root))).flatMap(
        ({ text }) =>
          [...text.matchAll(/\.request\(\s*'(?:get|post|put|patch|delete)',\s*'([^']+)'/g)].map(
            (match) => match[1]!,
          ),
      ),
    ),
  ].sort();
}

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
 * Modules from §D96's module-parity debt (FR-MOD-13.7's "tam modül paritesi"
 * payload) that have since been paid off, one subtask at a time.
 *
 * These are deliberately not `MATRIX` entries: the acceptance criterion names
 * Inbox/AI/CRM/Reports by name (`criterion`'s own type), and Team management
 * was never one of the four — it is the debt §C-A28 named separately. Folding
 * it into `MATRIX` would either widen `criterion`'s union with a word the KK
 * never used or misclassify it as one of the four; a second list keeps both
 * claims honest while still feeding the same two-way accounting below (every
 * request classified, every registry entry claimed).
 */
interface ParityModule {
  /** The module name §C-A28 used when it put this out of scope. */
  module: string;
  /** Which tab it is reached through — pushed from the header, not a root tab. */
  tab: RootTabName;
  /** Its directory under `src/features/`. */
  feature: string;
  screens: string[];
  routes: string[];
  endpoints: string[];
  registry: MobileEndpointKey[];
  narrowedTo: string;
}

const PARITY_MODULES: readonly ParityModule[] = [
  {
    module: 'Team',
    tab: 'Settings',
    feature: 'team',
    screens: ['TeamListScreen.tsx', 'TeamMemberScreen.tsx', 'GroupListScreen.tsx'],
    routes: ['TeamList', 'TeamMember', 'TeamGroups'],
    endpoints: ['/agents', '/agents/{agentId}/work-schedule', '/groups'],
    registry: ['agents', 'agentWorkSchedule', 'groups'],
    narrowedTo:
      'roster + identity card (built from the roster row, no per-agent GET exists) + work schedule + group list, all read-only; no role, suspension or expertise edits and no invite flow (13.7-m)',
  },
  {
    module: 'Playbook',
    tab: 'Settings',
    feature: 'playbook',
    screens: ['SkillListScreen.tsx', 'SkillDetailScreen.tsx', 'KnowledgeSourceListScreen.tsx'],
    routes: ['SkillList', 'SkillDetail', 'KnowledgeSources'],
    endpoints: ['/skills', '/skills/{skillId}', '/skills/{skillId}/runs', '/copilot/knowledge'],
    registry: ['skills', 'skill', 'skillRuns', 'copilotKnowledge'],
    narrowedTo:
      'skill list + read-only detail (instruction + step count, unlike the roster this has a real per-id GET) + recent runs + the copilot knowledge base, all read-only; no compiling, previewing, editing or activating a skill, no knowledge upload/delete, no AI agent persona management and `/knowledge-sources` (the customer-facing agent’s own sources) is not called either (13.7-n)',
  },
  {
    module: 'Billing',
    tab: 'Settings',
    feature: 'billing',
    screens: ['BillingScreen.tsx'],
    routes: ['Billing'],
    endpoints: [
      '/billing/subscription',
      '/billing/usage',
      '/billing/invoices',
      '/billing/entitlements',
    ],
    registry: ['billingSubscription', 'billingUsage', 'billingInvoices', 'billingEntitlements'],
    narrowedTo:
      'plan card + period usage + entitlement list + invoice rows (date, period, amount, status), all read-only; no plan/seat/cycle change, no API-package catalogue or purchase, and — a hard CLAUDE.md limit rather than a scope trim — no payment method (read or write) and no invoice download, both checked separately below so a card surface cannot land on the phone unnoticed (13.7-o)',
  },
];

/**
 * The shell: the way into the four surfaces, and the way back out (13.7-w).
 *
 * A third class rather than a row in either list above, because it answers a
 * different question. `MATRIX` and `PARITY_MODULES` ask "is this module on the
 * phone?"; this asks "can a person get to any of them?" — and until `13.7-p`
 * the honest answer was no, while every assertion above passed. That is the
 * whole of §D111: `MobileSession.signIn`, `signInWithSso`, `signOut` and
 * `switchAccount` had zero production callers, the sign-in screen did not
 * exist, and `RootNavigator` mounted the tab bar regardless of the session, so
 * a cold launch asked `/chats` without a token and stopped at a 401. Three
 * audits measured this item against its acceptance criterion in that state and
 * found it met, because nothing they read was about the door.
 *
 * So the shell is counted the same way the surfaces are — screens on disk,
 * routes typed and mounted, endpoints equal in both directions — and its
 * reachability is walked rather than described in `journey.test.tsx`.
 */
interface ShellSurface {
  /** What it is for, in the words `13.7-p`…`-r` used. */
  surface: 'Sign-in' | 'Account';
  /** Its directory under `src/features/`. */
  feature: string;
  screens: string[];
  routes: string[];
  /**
   * Where its request literals live. Unlike a surface, the shell has no
   * `api.ts`: everything it causes goes through `MobileSession`, which is the
   * point — one way to mint a token, and it is the console's own (13.7-b).
   */
  requestsFrom: string[];
  endpoints: string[];
  registry: MobileEndpointKey[];
  narrowedTo: string;
}

const SHELL: readonly ShellSurface[] = [
  {
    surface: 'Sign-in',
    feature: 'auth',
    screens: [
      'AuthStack.tsx',
      'SignInScreen.tsx',
      'WorkspacePickerScreen.tsx',
      'LoadingScreen.tsx',
    ],
    routes: ['SignIn', 'WorkspacePicker'],
    // `auth/session.ts` alone, not the whole of `auth/`: the handset's own push
    // registration is called from `auth/device-token-transport.ts` and is a
    // session decision rather than a screen, which is why it stays under
    // `SUPPORTING` below (§C-A31 · 13.7-l).
    requestsFrom: ['auth/session.ts'],
    endpoints: ['/auth/login', '/auth/authorize', '/auth/token', '/auth/me', '/auth/revoke'],
    registry: ['authLogin', 'authAuthorize', 'authToken', 'authMe', 'authRevoke'],
    narrowedTo:
      'email + password over `/auth/login`, one workspace picked from the memberships it answers with, then the console’s own S256 PKCE pair — plus the federated door through the device browser (§C-A29 · 13.7-q). No sign-up, no password reset and no "remember this device": all three are console jobs, and none of them may become a second way to mint a token (13.7-b · 13.7-p)',
  },
  {
    surface: 'Account',
    feature: 'account',
    screens: ['AccountScreen.tsx'],
    // `SwitchAccount` is `AuthStack` in `'switch'` mode, pushed while still
    // signed in — the one place the signed-out tree is reached from inside the
    // signed-in one (13.7-r).
    routes: ['Account', 'SwitchAccount'],
    requestsFrom: ['features/account'],
    endpoints: [],
    registry: [],
    narrowedTo:
      'name, email, workspace and role read straight off `sessionState.principal` — no second request, which is why its endpoint list is empty rather than short — plus sign out (revoke, then clear) and switch account (§C-A31 ordering, run by the session rather than this screen). No profile or password editing: desk work (§C-A28 · 13.7-r)',
  },
];

/**
 * Endpoints the phone calls that belong to no FR-MOD-13.7 surface.
 *
 * Every entry is load-bearing rather than a leftover, and all of them are here
 * so that the "classify everything" assertion below has somewhere honest to put
 * them instead of the matrix growing a fifth surface it does not have.
 */
const SUPPORTING: readonly { endpoints: string[]; why: string }[] = [
  {
    endpoints: ['/agents/me/notification-preferences'],
    why: 'FR-MOD-08.2 asks for one preference set consistent across channels, so the phone reads and writes the same five (13.7-j)',
  },
  {
    endpoints: ['/notifications/devices', '/notifications/devices/{deviceId}'],
    why: 'this handset registering itself as a delivery target — a session decision rather than a screen (§C-A31 · 13.7-l), which is why it is called from `auth/` and belongs to no surface',
  },
];

/**
 * What remains of the four modules §C-A28 put outside the phone, after Team
 * (13.7-m), Playbook (13.7-n) and Billing (13.7-o) were paid off into
 * `PARITY_MODULES` above.
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
  ];

/**
 * Paths inside Billing (13.7-o) that stay off the phone even though the
 * module itself is no longer wholly out of scope — unlike `OUT_OF_SCOPE`
 * above, which reasons about a module absent in full, this is a boundary
 * *inside* an adopted module. CLAUDE.md rules out a card/payment surface on
 * the phone outright ("kart / ödeme YOK"), so these three are named rather
 * than left to fall out of `Billing.endpoints` being short: a reader should
 * not have to diff two lists to see that the omission is deliberate.
 * Checked the same two ways `OUT_OF_SCOPE`'s entries are — non-vacuous, and
 * never requested — so a payment surface added later without touching this
 * file still fails loud.
 */
const FORBIDDEN_ENDPOINTS: readonly { path: string; why: string }[] = [
  {
    path: '/billing/payment-method',
    why: 'a card surface, read or write — CLAUDE.md rules this out on the phone outright, not as a scope trim (13.7-o)',
  },
  {
    path: '/billing/api-packages/purchases',
    why: 'spends money — buying an API package is a console job, and its purchase history is not read either (13.7-o)',
  },
  {
    path: '/billing/invoices/{period}/download',
    why: 'a mobile file/share flow for a CSV download is its own piece of work, not this one’s (13.7-o)',
  },
];

/**
 * What FR-MOD-13.7 does *not* claim, because this repository cannot produce it —
 * §D96's honesty record, reclassified by §D110.
 *
 * This was `OPEN_DEBTS` until the last of the closeable ones was paid (§D109).
 * What is left is not owed work: store publishing needs an Apple/Google developer
 * account, a native toolchain and a review queue, all of them outside CLAUDE.md's
 * "no production deploy" line and none of them schedulable here. §D97 already named
 * that class for SOC 2 / HIPAA certification — `⛔-süreç`: it is not turned into a
 * task, it does not count against the item, and the `✅` claims the code share only.
 * Kept as an assertion rather than a comment so that the day someone *does* add a
 * native build step, this matrix and the `13.7` row in `PLAN.md` are re-read.
 */
const SCOPE_BOUNDARIES = [
  'store publishing: the gate builds a JS bundle (`expo export`); no .ipa/.apk, no store submission (§D96 · ⛔-süreç per §D97/§D110)',
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
    const claimed = [
      ...MATRIX.flatMap((surface) => surface.registry),
      ...PARITY_MODULES.flatMap((module_) => module_.registry),
      ...SHELL.flatMap((entry) => entry.registry),
    ].sort();
    const registered = (Object.keys(MOBILE_ENDPOINTS) as MobileEndpointKey[])
      .filter((key) => key !== 'health')
      .sort();
    expect(claimed).toEqual(registered);

    for (const surface of MATRIX) {
      for (const key of surface.registry) {
        expect(surface.endpoints).toContain(MOBILE_ENDPOINTS[key]);
      }
    }
    for (const module_ of PARITY_MODULES) {
      for (const key of module_.registry) {
        expect(module_.endpoints).toContain(MOBILE_ENDPOINTS[key]);
      }
    }
    for (const entry of SHELL) {
      for (const key of entry.registry) {
        expect(entry.endpoints).toContain(MOBILE_ENDPOINTS[key]);
      }
    }
  });
});

// --- The module-parity debt paid off since the four named surfaces ---------

describe('module parity matrix — modules paid off since (§D96, one subtask at a time)', () => {
  it.each(PARITY_MODULES)('$module — has screens on disk under features/$feature', (module_) => {
    const dir = join(SRC, 'features', module_.feature);
    expect(existsSync(dir)).toBe(true);
    for (const screen of module_.screens) {
      expect(existsSync(join(dir, screen))).toBe(true);
    }
  });

  it.each(PARITY_MODULES)('$module — is reachable: its routes are typed and mounted', (module_) => {
    for (const route of module_.routes) {
      expect(NAVIGATION_SOURCE).toContain(`${route}:`);
      expect(MOUNTED_ROUTES).toContain(route);
    }
    expect(ROOT_TABS).toContain(module_.tab);
  });

  it.each(PARITY_MODULES)('$module — requests exactly the endpoints it claims', (module_) => {
    const api = readFileSync(join(SRC, 'features', module_.feature, 'api.ts'), 'utf8');
    const called = [...api.matchAll(/\.request\(\s*'(?:get|post|put|patch|delete)',\s*'([^']+)'/g)]
      .map((match) => match[1]!)
      .sort();
    expect([...new Set(called)]).toEqual([...module_.endpoints].sort());
  });

  it.each(PARITY_MODULES)(
    '$module — says what it narrowed, so parity is not overclaimed',
    (module_) => {
      expect(module_.narrowedTo.length).toBeGreaterThan(0);
    },
  );
});

// --- The shell those surfaces hang off --------------------------------------

describe('module parity matrix — the way in and the way out (13.7-w)', () => {
  it.each(SHELL)('$surface — has screens on disk under features/$feature', (entry) => {
    const dir = join(SRC, 'features', entry.feature);
    expect(existsSync(dir)).toBe(true);
    for (const screen of entry.screens) {
      expect(existsSync(join(dir, screen))).toBe(true);
    }
  });

  it.each(SHELL)('$surface — is reachable: its routes are typed and mounted', (entry) => {
    for (const route of entry.routes) {
      expect(NAVIGATION_SOURCE).toContain(`${route}:`);
      expect(MOUNTED_ROUTES).toContain(route);
    }
  });

  it.each(SHELL)('$surface — requests exactly the endpoints the matrix claims', (entry) => {
    expect(requestsUnder(entry.requestsFrom)).toEqual([...entry.endpoints].sort());
  });

  it.each(SHELL)('$surface — says what it narrowed, so parity is not overclaimed', (entry) => {
    expect(entry.narrowedTo.length).toBeGreaterThan(0);
  });

  it('branches the tree on the session rather than hiding the tabs', () => {
    // The §D111 defect itself, as an assertion: before `13.7-p` this file
    // mounted the four tabs whatever the session said, so every surface above
    // was "covered" and none of them was reachable with a token. A signed-out
    // person must have nowhere in the tab tree to be.
    const navigator = readFileSync(join(SRC, 'app', 'RootNavigator.tsx'), 'utf8');
    expect(navigator).toContain('useSessionState()');
    expect(navigator).toContain("status === 'signed-out'");
    expect(navigator).toContain('<AuthStack />');
  });

  it('keeps a thrown render and a dead radio from looking like an empty inbox', () => {
    // The two pieces `13.7-v` added that belong to no feature directory, so
    // nothing above would notice them being unwired — which is the failure mode
    // §D111 was: the code existed, and no production caller reached it.
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toContain('<ErrorBoundary>');
    expect(existsSync(join(SRC, 'app', 'ErrorBoundary.tsx'))).toBe(true);

    const readers = SOURCES.filter(({ text }) => text.includes('useConnectivity()')).map(
      ({ path }) => path,
    );
    expect(readers.length).toBeGreaterThan(0);
    expect(existsSync(join(SRC, 'lib', 'connectivity.ts'))).toBe(true);
  });
});

// --- What the phone calls, and nothing more ---------------------------------

describe('module parity matrix — every request is accounted for', () => {
  it('classifies each endpoint the app calls as a surface or as support', () => {
    const classified = [
      ...MATRIX.flatMap((surface) => surface.endpoints),
      ...PARITY_MODULES.flatMap((module_) => module_.endpoints),
      ...SHELL.flatMap((entry) => entry.endpoints),
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
  it('counts one — Team (13.7-m), Playbook (13.7-n) and Billing (13.7-o) paid off, Settings remains', () => {
    expect(OUT_OF_SCOPE).toHaveLength(1);
    expect(OUT_OF_SCOPE.map((entry) => entry.module.split(' ')[0])).toEqual(['Settings']);
  });

  it.each(OUT_OF_SCOPE)('$module — the product has it, and the phone never asks', (entry) => {
    // Non-vacuity first: an out-of-scope claim about endpoints that do not
    // exist would pass forever while proving nothing.
    const declared = CONTRACT_PATHS.filter(entry.matches);
    expect(declared.length).toBeGreaterThan(0);

    expect([...REQUESTED].filter(entry.matches)).toEqual([]);
  });

  it.each(FORBIDDEN_ENDPOINTS)('$path — the product has it, and the phone never asks', (entry) => {
    expect(CONTRACT_PATHS).toContain(entry.path);
    expect([...REQUESTED]).not.toContain(entry.path);
  });

  it('says why each forbidden endpoint stays off the phone', () => {
    for (const entry of FORBIDDEN_ENDPOINTS) {
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });

  it('ships no feature module the matrix does not account for', () => {
    const shipped = readdirSync(join(SRC, 'features'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // `notifications` is the FR-MOD-08.2 screen (13.7-j) — the one Settings
    // surface the criterion names by hand; `team`, `playbook` and `billing`
    // are the module-parity debt paid off so far (13.7-m, 13.7-n, 13.7-o) —
    // all four live in the Settings tab, none of them is a `MATRIX` surface.
    //
    // `auth` and `account` are neither surfaces nor modules but the shell they
    // are reached through, and they have carried a row of their own since
    // `13.7-w` (`SHELL` above) rather than being named here as exceptions.
    // Only `notifications` is still spelled out, because it is a lone screen
    // inside a surface the criterion already names.
    expect(shipped).toEqual(
      [
        ...MATRIX.map((surface) => surface.feature),
        ...PARITY_MODULES.map((module_) => module_.feature),
        ...SHELL.map((entry) => entry.feature),
        'notifications',
      ].sort(),
    );
  });

  it('names four tabs; the Settings tab carries FR-MOD-08.2, the Team + Playbook + Billing parity modules and Account, nothing from workspace administration', () => {
    expect([...ROOT_TABS]).toEqual(['Inbox', 'Customers', 'Reports', 'Settings']);
    // Whatever the tab is called, what it mounts is the notification
    // preferences screen plus the Team (13.7-m), Playbook (13.7-n), Billing
    // (13.7-o) and Account (13.7-r) surfaces — never a brand, webhook or PAT
    // screen, which is what `Settings (workspace administration)` above
    // still keeps off the phone.
    const settingsStack = readFileSync(join(SRC, 'app', 'stacks', 'SettingsStack.tsx'), 'utf8');
    expect(settingsStack).toContain('features/notifications/NotificationsScreen');
    expect(settingsStack).toContain('features/team/TeamListScreen');
    expect(settingsStack).toContain('features/team/TeamMemberScreen');
    expect(settingsStack).toContain('features/team/GroupListScreen');
    expect(settingsStack).toContain('features/playbook/SkillListScreen');
    expect(settingsStack).toContain('features/playbook/SkillDetailScreen');
    expect(settingsStack).toContain('features/playbook/KnowledgeSourceListScreen');
    expect(settingsStack).toContain('features/billing/BillingScreen');
    expect(settingsStack).toContain('features/account/AccountScreen');
    // `Account` (the card) and `SwitchAccount` (`AuthStack` in `'switch'`
    // mode) — the two routes 13.7-r added — on top of the original 8.
    expect([...settingsStack.matchAll(/name="(\w+)"/g)]).toHaveLength(10);
  });
});

// --- What this matrix refuses to hide: paid debts, and the one boundary -----

describe('module parity matrix — what is still owed', () => {
  it('registers the handset itself — the debt 13.7-k recorded, paid (13.7-l)', () => {
    // The inverse of the assertion this file shipped with. `13.7-b` built the
    // ordering (revoke before register on an account switch) and left the
    // provider and transport injectable because `13.7-c`'s endpoints did not
    // exist yet; `13.7-k` found them still unsupplied and wrote the gap down
    // here rather than hiding it. Both halves now exist, so the claim flips —
    // and it stays a claim about the app rather than about a file existing:
    // the phone asks for both ends of the registration.
    expect([...REQUESTED]).toContain('/notifications/devices');
    expect([...REQUESTED]).toContain('/notifications/devices/{deviceId}');

    // Wired, not merely written. The lifecycle takes both dependencies with
    // defaults that do nothing (`noDeviceToken`, a null transport), so a
    // construction that passed neither would leave every assertion above true
    // of code no session ever reaches.
    const services = readFileSync(join(SRC, 'app', 'services.tsx'), 'utf8');
    expect(services).toContain('provider: expoPushTokens');
    expect(services).toContain('createDeviceTokenTransport');
    expect(services).toContain('deviceTokens: buildDeviceTokens');

    // The dependency that made this a subtask of its own rather than part of
    // 13.7-k's verification pass.
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toHaveProperty('expo-notifications');
  });

  it('tells somebody whose phone is refusing what the account permits', () => {
    // The state that can only exist once registration is real: the account says
    // push is on and the handset shows nothing. Left unsaid, the screen would
    // read "delivered" to a person who is never interrupted (13.7-l).
    const settingsScreen = readFileSync(
      join(SRC, 'features', 'notifications', 'NotificationsScreen.tsx'),
      'utf8',
    );
    expect(settingsScreen).toContain('deviceBlocksPush');
    expect(settingsScreen).toContain('useDevicePushPermission');
  });

  it('builds a JS bundle, not a store artifact (§D96 · ⛔-süreç)', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['build']).toContain('expo export');
    // The boundary the `13.7` row names rather than carries: no native toolchain
    // step, so no `.ipa`/`.apk` and no submission. The row is `✅` for its PRD
    // acceptance criterion and this share is `⛔-süreç` (§D97's rule, §D110).
    expect(Object.values(manifest.scripts).join(' ')).not.toMatch(
      /eas |prebuild|run:ios|run:android/,
    );
  });

  it('counts the whole matrix in one place', () => {
    expect({
      surfacesCovered: MATRIX.length,
      modulesPaidOff: PARITY_MODULES.length,
      shellSurfaces: SHELL.length,
      modulesOutOfScope: OUT_OF_SCOPE.length,
      endpointsCalled: REQUESTED.size,
      contractEndpoints: CONTRACT_PATHS.length,
      scopeBoundaries: SCOPE_BOUNDARIES.length,
    }).toEqual({
      surfacesCovered: 4,
      // The way in (`SignIn` + `WorkspacePicker`) and the way out (`Account`).
      // Two rows that did not exist while §D111 was open, because neither
      // screen did — which is why the count is here rather than implied.
      shellSurfaces: 2,
      // The debt §D96 recorded pays down here one subtask at a time: Team
      // (13.7-m), then Playbook (13.7-n), then Billing (13.7-o), so
      // `OUT_OF_SCOPE` below drops from four to one — Settings is what is left.
      modulesPaidOff: 3,
      modulesOutOfScope: 1,
      // Not a target — a denominator. The phone reaching 26 of the product's
      // paths is what "screen parity, not endpoint parity" (§C-A28) costs, and
      // the number moving is a prompt to re-read this matrix rather than a failure.
      endpointsCalled: 26,
      // 183 → 184 with `/customer/chat/form-response` (08.7.7-b, tm 134.3).
      // A visitor-facing route: the widget posts the post-chat form answers to
      // it, and the phone is an agent app — nothing here to re-scope.
      // 184 → 185 with `/onboarding/survey` (FR-MOD-07.2, tm 139.6). Reports'
      // survey popover — desktop-console-only, nothing here to re-scope either.
      contractEndpoints: 185,
      scopeBoundaries: 1,
    });
  });
});
