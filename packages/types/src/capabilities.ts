/**
 * The permission matrix's catalogue (RL-02 · tm 325.1): what a workspace may
 * switch on or off per role, and the pure function that turns a role plus the
 * workspace's choices into the scopes a session holds.
 *
 * A capability is a row of the matrix the Founder sees ("Ekip Üyesi raporları
 * görsün mü"); the 70 scopes (`scopes.ts`) stay what routes check. The
 * catalogue is the bridge: each capability names the scopes its value grants,
 * so a choice in the matrix reaches every route through the gate that already
 * guards it (`config.scopes`), and the screens hide what the session cannot
 * reach the way they always have (`navigation.ts`, `settings-sections.ts`).
 *
 * Two kinds of row:
 *
 *   - **scope-backed** — `scopes` names what each value grants. Every scope a
 *     role holds today belongs to exactly one such row or to
 *     {@link MEMBER_BASE_SCOPES}, so turning a row off removes exactly its
 *     scopes and nothing a neighbouring row still grants.
 *   - **checked** — `scopes` is empty; a server check reads the resolved value
 *     (`capabilitiesForRole`). `chats.view`'s `own` level is one (it holds
 *     the `team` level's scopes; the narrowing to assigned and joined chats is
 *     the check's), and so are the Founder-only rows but `billing.manage`
 *     (whose scope is the owner's alone, `OWNER_SCOPES`).
 *
 * A capability whose surface does not exist yet is not listed here — a row
 * that changes nothing would tell the Founder something false. The feature
 * that builds the surface adds its row with its check (timeline export #334,
 * AI publish #316, team takeover #326, team-scoped reports #368, a player's
 * contact details tm 325.6).
 *
 * Here rather than in `apps/api` for the reason `role-scopes.ts` is: the REST
 * edge and the RTM gateway have to reach the same answer for the same session
 * (tm 145).
 */
import type { AgentRole } from './domain.js';
import { ROLE_RANK } from './role-scopes.js';
import type { Scope } from './scopes.js';

/**
 * The matrix's columns (K6): Kurucu, Yönetici, Ekip Lideri, Ekip Üyesi.
 * `viceowner` is not a column — it is being retired into `admin` (tm 324.3)
 * and reads the Yönetici column until the role is gone ({@link matrixRoleFor}).
 */
export const MATRIX_ROLES = [
  'owner',
  'admin',
  'team_lead',
  'agent',
] as const satisfies readonly AgentRole[];
export type MatrixRole = (typeof MATRIX_ROLES)[number];

/** The matrix's row groups, in the order the screen draws them. */
export const CAPABILITY_GROUPS = [
  'chats',
  'customers',
  'ai',
  'reports',
  'team',
  'settings',
  'billing',
  'logs',
] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

/**
 * How far a visibility capability reaches: nothing, the chats a person is
 * assigned to or has joined, their teams' chats, the whole workspace.
 */
export const CAPABILITY_LEVELS = ['none', 'own', 'team', 'all'] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/**
 * A cell's value. A switch is `off`/`on`; a level row takes the subset of
 * {@link CAPABILITY_LEVELS} its definition lists. Strings, not booleans, so
 * the stored override (`role_capability_overrides.value TEXT`) and the API
 * carry the same spelling.
 */
export type CapabilityValue = 'off' | 'on' | CapabilityLevel;

export interface CapabilityDefinition {
  readonly key: string;
  readonly group: CapabilityGroup;
  /** The web catalogue key of the row's name: `permissions.capability.<key>`. */
  readonly labelKey: string;
  /** Allowed values, weakest first; the first one holds nothing. */
  readonly values: readonly CapabilityValue[];
  /** What each value grants. A value absent here grants no scope. */
  readonly scopes: Readonly<Partial<Record<CapabilityValue, readonly Scope[]>>>;
  /**
   * The lowest role that may hold more than the weakest value — platform
   * safety, not a workspace choice. The matrix cannot give the capability to a
   * role below it (`capabilityChangeProblem` → `below_floor`) and the
   * resolution ignores a stored row that tries.
   */
  readonly floorRole: MatrixRole;
  /** Founder only: the whole row is locked — on for the owner, off for everyone else. */
  readonly ownerOnly?: true;
  /** The value a workspace that never touched the matrix gets. */
  readonly defaults: Readonly<Record<MatrixRole, CapabilityValue>>;
}

/**
 * What every member holds whatever the matrix says: their own account, profile
 * and teams, and what the inbox needs to work at all (reading the customer
 * record, the tags and saved replies of their teams, the brand list). None of
 * it reaches another person's account or the workspace's configuration.
 */
export const MEMBER_BASE_SCOPES = [
  'accounts--my:rw',
  'agents--my:rw',
  'customers:ro',
  'groups--my:ro',
  'tags--groups:ro',
  'canned_responses--groups:ro',
  'brands--all:ro',
] as const satisfies readonly Scope[];

/**
 * The catalogue. Defaults are the role sets, cell for cell
 * (`defaultScopesForRole`): RL-02 shipped them as the product behaved before
 * the matrix, and the owner's K7 decisions moved them in one separate step
 * (tm 325.5, PLAN §D337):
 *   - Ekip Üyesi sees only their own teams' chats — `chats.view` `team`, the
 *     level the role already had;
 *   - Ekip Lideri sees only their own teams in reports — `reports.view` stays
 *     `none` until the `team` level exists (#368): `all` would show every
 *     team's figures, more than K7 allows;
 *   - Yönetici sees billing and does not change it — `billing.manage` became
 *     Founder-only (`OWNER_SCOPES`);
 *   - only the Kurucu changes the matrix — `settings.permissions`, already
 *     Founder-only.
 *
 * Floors, and why each one sits where it does:
 *   - a route already refuses the role (`minimumRole: 'admin'` or a handler
 *     check): a cell below it would be on in the matrix and 403 at the route;
 *   - the act cannot be undone (erasing a player, NFR-C8);
 *   - workspace data leaves on its own once set up (webhooks, scheduled
 *     report mail, the SIEM stream);
 *   - the holder could widen their own reach (team membership decides which
 *     chats `team` visibility shows; inviting and changing roles).
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle (8 KB budget).
 */
export const CAPABILITIES = [
  // Sohbetler
  {
    // `own` = assigned or joined chats; `team` = today's `chats--access`
    // rule (the chat's teams ∩ the person's); `all` = the workspace. Archive
    // and takeover ride on it: the archive applies the same visibility rule,
    // and taking over or supervising any chat is what `chats--all:rw` opens
    // today. Team-bounded takeover is #326's row. K7: an Ekip Üyesi sees
    // their own teams' chats and the ones they are in, never another team's.
    key: 'chats.view',
    group: 'chats',
    labelKey: 'permissions.capability.chats.view',
    values: ['none', 'own', 'team', 'all'],
    scopes: {
      own: ['chats--access:rw'],
      team: ['chats--access:rw'],
      // The lower level too: today's admin set lists both, and a session's
      // stored list should stay byte-for-byte what it was.
      all: ['chats--access:rw', 'chats--all:rw'],
    },
    floorRole: 'agent',
    defaults: { owner: 'all', admin: 'all', team_lead: 'team', agent: 'team' },
  },
  {
    // `all` is also the ticket rules and the ticket email templates — they are
    // gated on `tickets--all:rw` today.
    key: 'tickets.view',
    group: 'chats',
    labelKey: 'permissions.capability.tickets.view',
    values: ['none', 'team', 'all'],
    scopes: {
      team: ['tickets--access:rw'],
      all: ['tickets--access:rw', 'tickets--all:rw'],
    },
    floorRole: 'agent',
    defaults: { owner: 'all', admin: 'all', team_lead: 'team', agent: 'team' },
  },
  // Oyuncu verisi. Seeing a player's email and username (RL-02-S2) joins this
  // group with its masking check (tm 325.6): until a server reads it, a row
  // the Founder could switch off would mask nothing (tm 325.3 security review).
  {
    // Editing player records, and the engage tools gated on the same scope
    // (campaigns, goals, traffic actions).
    key: 'customers.edit',
    group: 'customers',
    labelKey: 'permissions.capability.customers.edit',
    values: ['off', 'on'],
    scopes: { on: ['customers:rw'] },
    floorRole: 'agent',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    key: 'customers.ban',
    group: 'customers',
    labelKey: 'permissions.capability.customers.ban',
    values: ['off', 'on'],
    scopes: { on: ['customers.ban:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    key: 'customers.erase',
    group: 'customers',
    labelKey: 'permissions.capability.customers.erase',
    values: ['off', 'on'],
    scopes: { on: ['customers.erase:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  // AI
  {
    // The AI Agent's configuration: procedures, knowledge, tables, guidance,
    // handoff rules, templates.
    key: 'ai.manage',
    group: 'ai',
    labelKey: 'permissions.capability.ai.manage',
    values: ['off', 'on'],
    scopes: { on: ['agents-bot--all:rw'] },
    floorRole: 'agent',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // Compliance rules (AI-08): the routes are `exactRole: 'owner'`.
    key: 'ai.guardrails.edit',
    group: 'ai',
    labelKey: 'permissions.capability.ai.guardrails.edit',
    values: ['off', 'on'],
    scopes: {},
    floorRole: 'owner',
    ownerOnly: true,
    defaults: { owner: 'on', admin: 'off', team_lead: 'off', agent: 'off' },
  },
  // Raporlar
  {
    // A level row with no `team` level yet: a team-bounded report needs the
    // server-side team filter (#368), and `reports_read` alone opens the whole
    // workspace. `reports_read` also reads billing (`BILLING_READ_SCOPES`) and
    // every member's performance — opening this row opens those too. K7 wants
    // an Ekip Lideri to see their own teams' figures: `none` until #368 adds
    // the `team` level, which then becomes the Ekip Lideri default.
    key: 'reports.view',
    group: 'reports',
    labelKey: 'permissions.capability.reports.view',
    values: ['none', 'all'],
    scopes: { all: ['reports_read'] },
    floorRole: 'agent',
    defaults: { owner: 'all', admin: 'all', team_lead: 'none', agent: 'none' },
  },
  {
    // Scheduled report mail: workspace data leaves on a timer.
    key: 'reports.schedule',
    group: 'reports',
    labelKey: 'permissions.capability.reports.schedule',
    values: ['off', 'on'],
    scopes: { on: ['reports_manage'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  // Ekip
  {
    key: 'team.invite',
    group: 'team',
    labelKey: 'permissions.capability.team.invite',
    values: ['off', 'on'],
    scopes: { on: ['accounts--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // Other members' roles, suspension, profiles.
    key: 'team.members.manage',
    group: 'team',
    labelKey: 'permissions.capability.team.members.manage',
    values: ['off', 'on'],
    scopes: { on: ['agents--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // Teams and their membership — which decides what `team` visibility shows.
    key: 'team.groups.manage',
    group: 'team',
    labelKey: 'permissions.capability.team.groups.manage',
    values: ['off', 'on'],
    scopes: { on: ['groups--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  // Ayarlar
  {
    // IP allow-list, the 2FA requirement, trusted websites, partner apps,
    // custom fields, handoff routes, risk-flag settings.
    key: 'settings.security',
    group: 'settings',
    labelKey: 'permissions.capability.settings.security',
    values: ['off', 'on'],
    scopes: { on: ['access_rules:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // Company details, appearance and the setup checklist.
    key: 'settings.company',
    group: 'settings',
    labelKey: 'permissions.capability.settings.company',
    values: ['off', 'on'],
    scopes: { on: ['organization--my:rw', 'properties.configuration:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    key: 'settings.brands',
    group: 'settings',
    labelKey: 'permissions.capability.settings.brands',
    values: ['off', 'on'],
    scopes: { on: ['brands--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // Connecting a provider sends the workspace's conversations through it,
    // and the scope reads every channel message whatever the holder's teams.
    key: 'settings.channels',
    group: 'settings',
    labelKey: 'permissions.capability.settings.channels',
    values: ['off', 'on'],
    scopes: { on: ['channels--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // A webhook streams every event it subscribes to out of the workspace.
    key: 'settings.webhooks',
    group: 'settings',
    labelKey: 'permissions.capability.settings.webhooks',
    values: ['off', 'on'],
    scopes: { on: ['webhooks--all:rw'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    key: 'settings.tags',
    group: 'settings',
    labelKey: 'permissions.capability.settings.tags',
    values: ['off', 'on'],
    scopes: { on: ['tags--all:rw'] },
    floorRole: 'agent',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    key: 'settings.canned_responses',
    group: 'settings',
    labelKey: 'permissions.capability.settings.canned_responses',
    values: ['off', 'on'],
    scopes: { on: ['canned_responses--all:rw'] },
    floorRole: 'agent',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // SSO connections and their enforcement: `exactRole: 'owner'`.
    key: 'settings.sso',
    group: 'settings',
    labelKey: 'permissions.capability.settings.sso',
    values: ['off', 'on'],
    scopes: {},
    floorRole: 'owner',
    ownerOnly: true,
    defaults: { owner: 'on', admin: 'off', team_lead: 'off', agent: 'off' },
  },
  {
    // Changing this matrix (RL-02-S5).
    key: 'settings.permissions',
    group: 'settings',
    labelKey: 'permissions.capability.settings.permissions',
    values: ['off', 'on'],
    scopes: {},
    floorRole: 'owner',
    ownerOnly: true,
    defaults: { owner: 'on', admin: 'off', team_lead: 'off', agent: 'off' },
  },
  // Faturalama
  {
    // Changing the plan, seats, payment method, packages. Founder-only since K7
    // (tm 325.5): a Yönetici reads billing — it comes with `reports.view`
    // (`BILLING_READ_SCOPES`) — and does not change it. The one Founder-only
    // row that carries a scope: the billing routes check `billing_manage` (a
    // partner app can be granted it) and `exactRole: 'owner'` both, and the
    // scope sits in the owner's set alone (`OWNER_SCOPES`).
    key: 'billing.manage',
    group: 'billing',
    labelKey: 'permissions.capability.billing.manage',
    values: ['off', 'on'],
    scopes: { on: ['billing_manage'] },
    floorRole: 'owner',
    ownerOnly: true,
    defaults: { owner: 'on', admin: 'off', team_lead: 'off', agent: 'off' },
  },
  // Loglar
  {
    key: 'logs.audit.view',
    group: 'logs',
    labelKey: 'permissions.capability.logs.audit.view',
    values: ['off', 'on'],
    scopes: { on: ['audit_log--all:ro'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
  {
    // The SIEM stream (NFR-C6): the whole trail, continuously, out.
    key: 'logs.audit.export',
    group: 'logs',
    labelKey: 'permissions.capability.logs.audit.export',
    values: ['off', 'on'],
    scopes: { on: ['audit_log--export:ro'] },
    floorRole: 'admin',
    defaults: { owner: 'on', admin: 'on', team_lead: 'off', agent: 'off' },
  },
] as const satisfies readonly CapabilityDefinition[];

export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];

/** One stored choice — the shape of a `role_capability_overrides` row. */
export interface CapabilityOverride {
  readonly role: string;
  readonly capability: string;
  readonly value: string;
}

/** Why a cell cannot be changed, for the matrix's lock icon and the PUT's 400. */
export const CAPABILITY_LOCKS = ['owner_column', 'owner_only', 'below_floor'] as const;
export type CapabilityLock = (typeof CAPABILITY_LOCKS)[number];

export const CAPABILITY_CHANGE_PROBLEMS = [
  'unknown_role',
  'unknown_capability',
  'invalid_value',
  'locked',
  'below_floor',
] as const;
export type CapabilityChangeProblem = (typeof CAPABILITY_CHANGE_PROBLEMS)[number];

export function capabilityDefinition(key: string): CapabilityDefinition | undefined {
  return (CAPABILITIES as readonly CapabilityDefinition[]).find((c) => c.key === key);
}

/**
 * The column a member's role reads. `viceowner` reads the Yönetici column: it
 * holds the admin set today, and a column of its own would let a restriction
 * the Founder puts on admins miss the one role ranked above them. A role the
 * matrix does not know reads the Ekip Üyesi column — unknown is the lowest
 * rank, as in `defaultScopesForRole`.
 */
export function matrixRoleFor(role: string): MatrixRole {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'viceowner') return 'admin';
  if (role === 'team_lead') return 'team_lead';
  return 'agent';
}

/**
 * Whether a cell is locked, and why. The Kurucu column is locked whole: the
 * Founder holds every capability, so the one person who can change the matrix
 * cannot switch off their own way back into it.
 */
export function capabilityLock(
  definition: CapabilityDefinition,
  role: MatrixRole,
): CapabilityLock | null {
  if (role === 'owner') return 'owner_column';
  if (definition.ownerOnly) return 'owner_only';
  if (ROLE_RANK[role] < ROLE_RANK[definition.floorRole]) return 'below_floor';
  return null;
}

/**
 * Whether the matrix may store this change — the PUT's validation. A change
 * that sets a locked cell to the value it already holds is not a change and
 * passes, so a client may send whole rows back.
 */
export function capabilityChangeProblem(
  change: CapabilityOverride,
): CapabilityChangeProblem | null {
  if (!(MATRIX_ROLES as readonly string[]).includes(change.role)) return 'unknown_role';
  const definition = capabilityDefinition(change.capability);
  if (!definition) return 'unknown_capability';
  if (!(definition.values as readonly string[]).includes(change.value)) return 'invalid_value';
  const role = change.role as MatrixRole;
  const lock = capabilityLock(definition, role);
  if (lock !== null && change.value !== definition.defaults[role]) {
    return lock === 'below_floor' ? 'below_floor' : 'locked';
  }
  return null;
}

/**
 * Every capability's value for a member of `role` in a workspace whose stored
 * choices are `overrides` — what `/auth/me` reports and what a checked
 * capability reads.
 *
 * The order, per capability:
 *   1. the role's column ({@link matrixRoleFor});
 *   2. a locked cell keeps its default — a stored row cannot unlock it;
 *   3. otherwise the column's stored value, if it is one the capability
 *      allows;
 *   4. otherwise the default.
 * A row the PUT would refuse (an unknown capability or role, a value outside
 * the row, a cell below its floor) is ignored rather than trusted: the table
 * is TEXT, and the validator is not the only thing that can write it.
 */
export function capabilitiesForRole(
  role: string,
  overrides: readonly CapabilityOverride[],
): Record<CapabilityKey, CapabilityValue> {
  const column = matrixRoleFor(role);
  const stored = new Map<string, string>();
  for (const row of overrides) {
    if (row.role === column) stored.set(row.capability, row.value);
  }
  const out = {} as Record<CapabilityKey, CapabilityValue>;
  for (const definition of CAPABILITIES as readonly CapabilityDefinition[]) {
    const key = definition.key as CapabilityKey;
    const fallback = definition.defaults[column];
    const value = stored.get(key);
    out[key] =
      value !== undefined &&
      capabilityLock(definition, column) === null &&
      (definition.values as readonly string[]).includes(value)
        ? (value as CapabilityValue)
        : fallback;
  }
  return out;
}

/**
 * The scopes a member of `role` holds in this workspace: the base set, plus
 * what each capability's resolved value grants. With no overrides this is
 * `defaultScopesForRole(role)` as a set — the regression bar RL-02 holds
 * itself to.
 *
 * Route gates stay the last word: a scope this returns does not get past a
 * `minimumRole` or `exactRole` the role fails.
 */
export function scopesForRole(role: string, overrides: readonly CapabilityOverride[]): Scope[] {
  const values = capabilitiesForRole(role, overrides);
  const out = new Set<Scope>(MEMBER_BASE_SCOPES);
  for (const definition of CAPABILITIES as readonly CapabilityDefinition[]) {
    const value = values[definition.key as CapabilityKey];
    for (const scope of definition.scopes[value] ?? []) out.add(scope);
  }
  return [...out];
}

/**
 * Whether a resolved `value` of capability `key` reaches `minimum` — by default
 * anything above the weakest value. An unknown key or a `minimum` the
 * capability does not have answers false: a check that cannot be read is a
 * refusal.
 */
export function capabilityAtLeast(
  key: string,
  value: CapabilityValue | undefined,
  minimum?: CapabilityValue,
): boolean {
  const definition = capabilityDefinition(key);
  if (!definition || value === undefined) return false;
  const at = definition.values.indexOf(value);
  const needed = minimum === undefined ? 1 : definition.values.indexOf(minimum);
  return at >= 0 && needed >= 0 && at >= needed;
}
