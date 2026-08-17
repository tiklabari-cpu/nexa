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
    endpoints: ['/auth/login', '/auth/authorize', '/auth/token', '/auth/me', '/auth/revoke'],
    why: 'the session itself — the console’s own OAuth 2.1 + PKCE pair, no second way to mint a token (13.7-b)',
  },
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
 * (13.7-m) and Playbook (13.7-n) were paid off into `PARITY_MODULES` above.
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

// --- What the phone calls, and nothing more ---------------------------------

describe('module parity matrix — every request is accounted for', () => {
  it('classifies each endpoint the app calls as a surface or as support', () => {
    const classified = [
      ...MATRIX.flatMap((surface) => surface.endpoints),
      ...PARITY_MODULES.flatMap((module_) => module_.endpoints),
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
  it('counts two — Team (13.7-m) and Playbook (13.7-n) paid off, Settings/Billing remain', () => {
    expect(OUT_OF_SCOPE).toHaveLength(2);
    expect(OUT_OF_SCOPE.map((entry) => entry.module.split(' ')[0])).toEqual([
      'Settings',
      'Billing',
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
    // surface the criterion names by hand; `team` and `playbook` are the
    // module-parity debt paid off so far (13.7-m, 13.7-n) — all three live in
    // the Settings tab, none of them is a `MATRIX` surface.
    expect(shipped).toEqual(
      [
        ...MATRIX.map((surface) => surface.feature),
        ...PARITY_MODULES.map((module_) => module_.feature),
        'notifications',
      ].sort(),
    );
  });

  it('names four tabs; the Settings tab carries FR-MOD-08.2 and the Team + Playbook parity modules, nothing from workspace administration', () => {
    expect([...ROOT_TABS]).toEqual(['Inbox', 'Customers', 'Reports', 'Settings']);
    // Whatever the tab is called, what it mounts is the notification
    // preferences screen plus the Team (13.7-m) and Playbook (13.7-n)
    // surfaces — never a brand, webhook or PAT screen, which is what
    // `Settings (workspace administration)` above still keeps off the phone.
    const settingsStack = readFileSync(join(SRC, 'app', 'stacks', 'SettingsStack.tsx'), 'utf8');
    expect(settingsStack).toContain('features/notifications/NotificationsScreen');
    expect(settingsStack).toContain('features/team/TeamListScreen');
    expect(settingsStack).toContain('features/team/TeamMemberScreen');
    expect(settingsStack).toContain('features/team/GroupListScreen');
    expect(settingsStack).toContain('features/playbook/SkillListScreen');
    expect(settingsStack).toContain('features/playbook/SkillDetailScreen');
    expect(settingsStack).toContain('features/playbook/KnowledgeSourceListScreen');
    expect([...settingsStack.matchAll(/name="(\w+)"/g)]).toHaveLength(7);
  });
});

// --- The debt this matrix refuses to hide -----------------------------------

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
      modulesPaidOff: PARITY_MODULES.length,
      modulesOutOfScope: OUT_OF_SCOPE.length,
      endpointsCalled: REQUESTED.size,
      contractEndpoints: CONTRACT_PATHS.length,
      openDebts: OPEN_DEBTS.length,
    }).toEqual({
      surfacesCovered: 4,
      // The debt §D96 recorded pays down here one subtask at a time: Team
      // (13.7-m) then Playbook (13.7-n), so `OUT_OF_SCOPE` below drops from
      // four to two — Settings and Billing are what is left.
      modulesPaidOff: 2,
      modulesOutOfScope: 2,
      // Not a target — a denominator. The phone reaching 22 of the product's
      // paths is what "screen parity, not endpoint parity" (§C-A28) costs, and
      // the number moving is a prompt to re-read this matrix rather than a failure.
      endpointsCalled: 22,
      contractEndpoints: 183,
      openDebts: 1,
    });
  });
});
