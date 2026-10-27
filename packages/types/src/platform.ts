/**
 * Operator roles and the permission matrix of the root panel (tm 389.4 ·
 * docs/platform-admin/requirements.md §2 · FR-ADMIN-01…04).
 *
 * One list, read by both sides: the platform API refuses a route whose
 * `config.platform.permission` the operator's role does not hold
 * (`plugins/platform-auth.ts`), and the admin SPA (389.6) hides the menu entries
 * the same role cannot open. Hiding is convenience; the server's refusal is the
 * control, which is why the matrix lives here rather than in either app.
 *
 * Operators (`platform_admins`) are not workspace members (`accounts`): an
 * address may be both, with two sessions that know nothing of each other.
 *
 * Every permission says whether it is a `read` or a `write`. That flag is what
 * makes "readonly can mutate nothing" checkable rather than a convention: the
 * matrix test asserts the readonly row holds no `write`, and the route test
 * asserts every route that changes state names a `write` permission.
 *
 * The vocabulary is coarse on purpose — one read and, where a module has
 * actions, one or two writes split along the role lines of requirements §2
 * (support acts on accounts and trials, billing on plans and payments, only a
 * superadmin on settings, suspension, deletion and operators). A later module
 * (389.8–389.20) that needs a finer line adds a permission here, never a role
 * check in its handler.
 *
 * Literals only at the top level: this package is imported by the widget
 * loader, whose bundle keeps any module whose top level calls something.
 */

export const PLATFORM_ROLES = ['superadmin', 'support', 'billing', 'readonly'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type PlatformPermissionKind = 'read' | 'write';

export interface PlatformPermissionSpec {
  kind: PlatformPermissionKind;
  roles: readonly PlatformRole[];
}

export const PLATFORM_PERMISSIONS = {
  // --- Reads ---------------------------------------------------------------
  'dashboard.read': { kind: 'read', roles: ['superadmin', 'support', 'billing', 'readonly'] },
  'workspaces.read': { kind: 'read', roles: ['superadmin', 'support', 'billing', 'readonly'] },
  'accounts.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'billing.read': { kind: 'read', roles: ['superadmin', 'support', 'billing', 'readonly'] },
  'usage.read': { kind: 'read', roles: ['superadmin', 'support', 'billing', 'readonly'] },
  'settings.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'ai.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'operations.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'audit.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'security.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },
  'admins.read': { kind: 'read', roles: ['superadmin', 'support', 'readonly'] },

  // --- Writes --------------------------------------------------------------
  /** Trial extensions, resent verification mails, notes — the support desk's actions. */
  'workspaces.support': { kind: 'write', roles: ['superadmin', 'support'] },
  /** Activation, plan changes, overrides and AI caps on one workspace. */
  'workspaces.billing': { kind: 'write', roles: ['superadmin', 'billing'] },
  /** Suspension, read-only, cancellation, forced ownership transfer, deletion. */
  'workspaces.lifecycle': { kind: 'write', roles: ['superadmin'] },
  /** Resent verification, forced password reset, revoked sessions and tokens. */
  'accounts.support': { kind: 'write', roles: ['superadmin', 'support'] },
  /** Second-factor reset, suspension, export and erasure of an account. */
  'accounts.manage': { kind: 'write', roles: ['superadmin'] },
  'billing.manage': { kind: 'write', roles: ['superadmin', 'billing'] },
  'usage.manage': { kind: 'write', roles: ['superadmin', 'billing'] },
  'settings.manage': { kind: 'write', roles: ['superadmin'] },
  'ai.manage': { kind: 'write', roles: ['superadmin'] },
  /** "Run now" on a scheduler job, opening a missing events partition (389.14). */
  'operations.trigger': { kind: 'write', roles: ['superadmin', 'support'] },
  /** Purging expired unverified sign-ups, re-embedding — the operations that delete or spend. */
  'operations.run': { kind: 'write', roles: ['superadmin'] },
  'security.manage': { kind: 'write', roles: ['superadmin'] },
  /** "Enter as the customer", read-only mode (389.15). */
  'support.impersonate': { kind: 'write', roles: ['superadmin', 'support'] },
  /** The same in `full` mode — superadmin and a fresh TOTP. */
  'support.impersonate_full': { kind: 'write', roles: ['superadmin'] },
  /** Invitations, role changes, disabling, second-factor resets, session revocation. */
  'admins.manage': { kind: 'write', roles: ['superadmin'] },
} as const satisfies Record<string, PlatformPermissionSpec>;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

/**
 * A session is `password` from sign-in until the second factor is shown, then
 * `active`. Only an active session reaches a business route.
 */
export const PLATFORM_SESSION_STAGES = ['password', 'active'] as const;
export type PlatformSessionStage = (typeof PLATFORM_SESSION_STAGES)[number];

/**
 * What a `password`-stage session has to do next: enrol an authenticator (an
 * operator who never has, or whose factor was reset) or show a code.
 */
export type PlatformNextStep = 'totp_enroll' | 'totp_verify';

/**
 * How long a TOTP code keeps a session "recent" for the destructive routes
 * (`recentTotp`, FR-ADMIN-02): five minutes, after which they ask again.
 */
export const PLATFORM_RECENT_TOTP_SECONDS = 300;

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPermission(value: unknown): value is PlatformPermission {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM_PERMISSIONS, value)
  );
}

/** Whether `role` holds `permission`. Unknown either way is no. */
export function platformRoleHas(role: string, permission: string): boolean {
  if (!isPlatformRole(role) || !isPlatformPermission(permission)) return false;
  const spec: PlatformPermissionSpec = PLATFORM_PERMISSIONS[permission];
  return spec.roles.includes(role);
}

/** Every permission `role` holds, in declaration order — what `/auth/me` returns. */
export function platformPermissionsFor(role: string): PlatformPermission[] {
  if (!isPlatformRole(role)) return [];
  return (Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[]).filter((permission) =>
    platformRoleHas(role, permission),
  );
}

/**
 * The components the root panel's health grid lists (tm 389.8 · FR-ADMIN-07) —
 * the keys of the `siyahtus:ops:components` record the tenant API writes to
 * (`reportComponentStatus`). A closed list: a key not named here is refused on
 * write and never shown, so a typo cannot grow a tile nobody owns. The four
 * the scheduler leader reports itself are `mail`, `redis`, `db`, `scheduler`;
 * the rest are reported by their own modules (389.14).
 */
export const OPS_COMPONENTS = [
  'mail',
  'redis',
  'db',
  'scheduler',
  'ai_jobs',
  'knowledge_jobs',
  'doc_worker',
  'captcha',
  'geoip',
  'channel_whatsapp',
  'channel_meta',
  'webhooks',
] as const;
export type OpsComponentKey = (typeof OPS_COMPONENTS)[number];

/** `not_installed`: the module is not part of this deployment — not a fault. */
export const OPS_COMPONENT_STATES = ['ok', 'degraded', 'down', 'not_installed'] as const;
export type OpsComponentState = (typeof OPS_COMPONENT_STATES)[number];

export function isOpsComponentKey(value: unknown): value is OpsComponentKey {
  return typeof value === 'string' && (OPS_COMPONENTS as readonly string[]).includes(value);
}

/**
 * The root panel's command channel to the tenant processes (design.md §A):
 * Redis pub/sub, one JSON object per message, `{ "type": … }`. Senders publish
 * after committing; a message nobody heard costs at most a reader's cache
 * lifetime, never correctness.
 */
export const PLATFORM_OPS_CHANNEL = 'siyahtus:platform:ops';

/** A deployment setting changed (tm 389.13): every tenant process drops its copy. */
export const PLATFORM_SETTINGS_CHANGED = 'settings.changed';

/**
 * The AI provider settings changed (tm 389.17 · FR-ADMIN-18): every tenant
 * process rebuilds its model and embedding providers from
 * `platform_ai_settings()` — without a restart.
 */
export const PLATFORM_AI_SETTINGS_CHANGED = 'ai.settings_changed';

/**
 * Where the root panel's AI settings stand (tm 389.17): `db` — a row in
 * `platform_settings` decides; `env` — none, the tenant API's environment does.
 */
export const AI_SETTINGS_SOURCES = ['db', 'env'] as const;
export type AiSettingsSource = (typeof AI_SETTINGS_SOURCES)[number];

/**
 * The knowledge re-embedding the root panel started (tm 389.17): a Redis
 * hash of its progress, and the lock that keeps a second run from starting
 * beside it.
 */
export const OPS_AI_REEMBED_KEY = 'siyahtus:ops:ai-reembed';
export const OPS_AI_REEMBED_LOCK_KEY = 'siyahtus:ops:ai-reembed:lock';

export interface PlatformOpsMessage {
  type: string;
  /** The `platform_settings` keys that moved, where the sender says. */
  keys?: string[];
}

/** A message off {@link PLATFORM_OPS_CHANNEL}, or null when it is not one. */
export function parsePlatformOpsMessage(message: string): PlatformOpsMessage | null {
  try {
    const value: unknown = JSON.parse(message);
    if (typeof value !== 'object' || value === null) return null;
    const { type, keys } = value as Record<string, unknown>;
    if (typeof type !== 'string') return null;
    return Array.isArray(keys)
      ? { type, keys: keys.filter((key): key is string => typeof key === 'string') }
      : { type };
  } catch {
    return null;
  }
}

/**
 * Maintenance mode as the realtime gateway reads it (tm 389.13): JSON
 * `{ "mode": "read_only" | "full" }`, absent while it is off. Written by the
 * root panel when it changes and re-written from the database by the tenant
 * API's scheduler leader, so a flushed Redis comes back within one interval.
 */
export const OPS_MAINTENANCE_KEY = 'siyahtus:ops:maintenance';

/** The tenant API's effective configuration (FR-ADMIN-16), published by its leader. */
export const OPS_CONFIG_KEY = 'siyahtus:ops:config';

/**
 * Where an effective setting comes from: the root panel's database row, the
 * process environment, or the built-in default.
 */
export const EFFECTIVE_CONFIG_SOURCES = ['db', 'env', 'default'] as const;
export type EffectiveConfigSource = (typeof EFFECTIVE_CONFIG_SOURCES)[number];

/**
 * "Run this scheduler job now" (tm 389.14): `{ type: 'job.run', name, request_id }`.
 * Every tenant process whose scheduler is on hears it; the one that wins the
 * `request_id` claim runs the job (`services/ops/ops-channel.ts`).
 */
export const PLATFORM_JOB_RUN = 'job.run';

/**
 * The channel "run now" travels on (tm 389.14), apart from
 * {@link PLATFORM_OPS_CHANNEL}: every tenant API process and every RTM
 * subscribes to that one for `settings.changed` (tm 389.13), so its
 * `PUBLISH` count no longer says whether a scheduler heard. Only the
 * scheduler-enabled processes subscribe here, and `no_listener` stays true.
 */
export const PLATFORM_JOB_CHANNEL = 'siyahtus:platform:ops:jobs';

// --- "Enter as the customer" (tm 389.15 · FR-ADMIN-21 · design.md §G) ------

/**
 * How an operator is signed in as a member. `read_only` (the default) refuses
 * every write; `full` acts as the member — superadmin only, with a fresh
 * TOTP. Neither reaches past the member's own role: the session carries the
 * member's role and the workspace's permission matrix, never more.
 */
export const IMPERSONATION_MODES = ['read_only', 'full'] as const;
export type ImpersonationMode = (typeof IMPERSONATION_MODES)[number];

export function isImpersonationMode(value: unknown): value is ImpersonationMode {
  return typeof value === 'string' && (IMPERSONATION_MODES as readonly string[]).includes(value);
}

/**
 * How long the one-time handoff code lasts: one browser redirect from the
 * root panel to the workspace console, not a link anybody keeps.
 */
export const IMPERSONATION_HANDOFF_TTL_SECONDS = 60;

/** A session's lifetime unless `PLATFORM_IMPERSONATION_TTL` says otherwise (30 min). */
export const IMPERSONATION_TTL_DEFAULT_SECONDS = 1800;

/**
 * Why a session stopped before its window ran out: an operator ended it from
 * the root panel, or the one signed in ended it from the workspace console's
 * banner. A session whose window simply ran out keeps `end_reason` empty.
 */
export const IMPERSONATION_END_REASONS = ['ended_by_operator', 'ended_in_workspace'] as const;
export type ImpersonationEndReason = (typeof IMPERSONATION_END_REASONS)[number];

/**
 * Where the workspace console redeems a handoff code: `#code=` in the
 * fragment, so the code never reaches a server log, a proxy or a referrer.
 */
export const IMPERSONATION_CONSOLE_PATH = '/auth/impersonate';

/** Why a route is closed to an operator signed in as a member, in any mode. */
export type ImpersonationForbiddenCategory =
  | 'sign_in'
  | 'password'
  | 'two_factor'
  | 'credentials'
  | 'security'
  | 'membership'
  | 'payment'
  | 'subscription'
  | 'baa'
  | 'data_deletion'
  | 'sandbox'
  | 'data_egress'
  | 'not_a_member_surface';

export interface ImpersonationForbiddenRule {
  /** Matched against the tenant route's path under `/api/v1`; a parameter is one segment. */
  pattern: RegExp;
  category: ImpersonationForbiddenCategory;
}

/**
 * The writes no operator may make on a member's behalf, whatever the mode
 * (requirements §3.10: passwords, second factors, personal and partner
 * credentials, SCIM, security settings, payment, the subscription, the BAA,
 * erasure, the sandbox). On top of the requirement's list: whatever gives
 * somebody new standing access (invitations, roles, suspensions) or sends the
 * workspace's data somewhere new (webhooks, SIEM, apps, share links,
 * scheduled exports) — an operator who could do either could keep a door open
 * after the session ends — and the sign-in and visitor surfaces, which a
 * member's credential has no business presenting at all.
 *
 * Paths are the contract's, relative to `/api/v1`; `[^/]+` stands for a path
 * parameter so `{customerId}` and Fastify's `:customerId` both match. Every
 * mutating operation of the tenant contract is either here, in
 * {@link IMPERSONATION_ALLOWED_WRITES} or one of {@link IMPERSONATION_EXIT_PATHS}
 * (`apps/api/src/plugins/impersonation-gate.test.ts`), and this list wins
 * where both match. A write in neither is refused too: a route added without
 * a decision is closed.
 */
export const IMPERSONATION_FORBIDDEN_PATHS: readonly ImpersonationForbiddenRule[] = [
  {
    pattern:
      /^\/auth\/(login|authorize|token|signup|verify-email|verify-email\/resend|invitations\/accept|saml\/[^/]+\/acs|impersonation\/exchange)$/,
    category: 'sign_in',
  },
  { pattern: /^\/auth\/password-reset(\/confirm)?$/, category: 'password' },
  { pattern: /^\/auth\/2fa(\/(enroll|activate|recovery-codes))?$/, category: 'two_factor' },
  { pattern: /^\/auth\/personal-access-tokens(\/[^/]+)?$/, category: 'credentials' },
  { pattern: /^\/settings\/scim-tokens(\/[^/]+)?$/, category: 'credentials' },
  { pattern: /^\/partner\/apps(\/.*)?$/, category: 'credentials' },
  {
    pattern: /^\/settings\/member-recognition(\/(rotate-key|revoke-all))?$/,
    category: 'credentials',
  },
  { pattern: /^\/scim\/v2\//, category: 'credentials' },
  { pattern: /^\/settings\/security$/, category: 'security' },
  { pattern: /^\/settings\/ip-allowlist(\/[^/]+)?$/, category: 'security' },
  { pattern: /^\/settings\/permissions$/, category: 'security' },
  { pattern: /^\/settings\/sso(\/.*)?$/, category: 'security' },
  { pattern: /^\/invitations(\/[^/]+)?$/, category: 'membership' },
  { pattern: /^\/agents\/[^/]+\/(role|suspension)$/, category: 'membership' },
  { pattern: /^\/billing\/(payment-method|api-packages|ai-packages)$/, category: 'payment' },
  { pattern: /^\/billing\/subscription$/, category: 'subscription' },
  { pattern: /^\/settings\/compliance\/baa$/, category: 'baa' },
  { pattern: /^\/customers\/[^/]+\/erase$/, category: 'data_deletion' },
  { pattern: /^\/settings\/retention$/, category: 'data_deletion' },
  { pattern: /^\/settings\/sandbox(\/reset)?$/, category: 'sandbox' },
  { pattern: /^\/webhooks(\/[^/]+)?$/, category: 'data_egress' },
  { pattern: /^\/settings\/siem$/, category: 'data_egress' },
  { pattern: /^\/settings\/apps\//, category: 'data_egress' },
  { pattern: /^\/reports\/(share-links|scheduled-exports)(\/[^/]+)?$/, category: 'data_egress' },
  { pattern: /^\/customer\//, category: 'not_a_member_surface' },
  { pattern: /^\/channels\/[^/]+\/webhook$/, category: 'not_a_member_surface' },
  { pattern: /^\/channels\/telegram\/webhook\/[^/]+$/, category: 'not_a_member_surface' },
  { pattern: /^\/channels\/email\/inbound$/, category: 'not_a_member_surface' },
];

/**
 * The writes a `full` session may make — the member's daily work, by
 * resource. Named one resource at a time (the settings sections included) so a
 * new resource is a decision somebody writes down here, not a door that opens
 * on its own; {@link IMPERSONATION_FORBIDDEN_PATHS} still wins inside these.
 */
export const IMPERSONATION_ALLOWED_WRITES: readonly RegExp[] = [
  /^\/chats(\/.*)?$/,
  /^\/tickets(\/.*)?$/,
  /^\/customers\/[^/]+(\/.*)?$/,
  /^\/agents\/[^/]+\/[a-z-]+$/,
  /^\/groups(\/.*)?$/,
  /^\/brands(\/.*)?$/,
  /^\/websites(\/.*)?$/,
  /^\/channels\/(email\/addresses|[^/]+\/(connect|disconnect|messages))(\/.*)?$/,
  /^\/campaigns(\/.*)?$/,
  /^\/goals(\/.*)?$/,
  /^\/handoff-routes(\/.*)?$/,
  /^\/kb-(articles|categories|settings)(\/.*)?$/,
  /^\/knowledge-(sources|tables|jobs)(\/.*)?$/,
  /^\/skills(\/.*)?$/,
  /^\/copilot\//,
  /^\/palette\//,
  /^\/mcp\/tools\/[^/]+$/,
  /^\/ai-agents(\/.*)?$/,
  /^\/ai-guardrails\//,
  /^\/ai-guidance(\/.*)?$/,
  /^\/ai-handoffs\//,
  /^\/ai-templates\//,
  /^\/ai-access-info$/,
  /^\/ai\//,
  /^\/risk-flags(\/.*)?$/,
  /^\/notifications\/devices(\/[^/]+)?$/,
  /^\/onboarding\//,
  /^\/uploads(\/.*)?$/,
  /^\/settings\/(appearance|bots|canned-responses|chat-timeout|company|custom-fields|expertise|prechat|routing-rules|sales-tracker|sla|tags|ticket-email-templates|ticket-rules|trusted-domains|widget)(\/.*)?$/,
];

/**
 * The writes even a `read_only` session makes: leaving. Signing out
 * (`/auth/revoke`) and ending the session from the console's banner.
 */
export const IMPERSONATION_EXIT_PATHS: readonly string[] = [
  '/auth/revoke',
  '/auth/impersonation/end',
];

export type ImpersonationWriteVerdict =
  | { verdict: 'exit' }
  | { verdict: 'allowed' }
  | { verdict: 'forbidden'; category: ImpersonationForbiddenCategory }
  | { verdict: 'unclassified' };

/**
 * What an impersonation session may do with a write to `path` (relative to
 * `/api/v1`, parameters in either spelling). Reads are not asked about: every
 * mode reads what the member's role reads.
 */
export function impersonationWriteVerdict(path: string): ImpersonationWriteVerdict {
  const normalized = path.replace(/\{[^/}]+\}|:[^/]+/g, 'x');
  if (IMPERSONATION_EXIT_PATHS.includes(normalized)) return { verdict: 'exit' };
  for (const rule of IMPERSONATION_FORBIDDEN_PATHS) {
    if (rule.pattern.test(normalized)) return { verdict: 'forbidden', category: rule.category };
  }
  if (IMPERSONATION_ALLOWED_WRITES.some((pattern) => pattern.test(normalized))) {
    return { verdict: 'allowed' };
  }
  return { verdict: 'unclassified' };
}

// --- Sign-up blocklist (tm 389.16) -------------------------------------------

/** What a `platform_blocklist` entry matches: an address, a domain (and its subdomains), an IP or CIDR. */
export const PLATFORM_BLOCKLIST_KINDS = ['email', 'domain', 'ip'] as const;

export type PlatformBlocklistKind = (typeof PLATFORM_BLOCKLIST_KINDS)[number];

// --- Operator alerts (tm 389.20) ---------------------------------------------

/**
 * What the platform scan mails operators about (FR-ADMIN-24) — a closed list:
 * `platform_alert_prefs.kinds` stores these names and a stored name outside the
 * list is ignored, not mailed.
 */
export const PLATFORM_ALERT_KINDS = [
  'trial_ending',
  'payment_request_waiting',
  'ai_cap_reached',
  'health_red',
  'audit_chain_broken',
  'purge_tomorrow',
] as const;

export type PlatformAlertKind = (typeof PLATFORM_ALERT_KINDS)[number];

/** The kinds that repeat hourly while they hold; the others are mailed once a day per target. */
export const PLATFORM_CRITICAL_ALERT_KINDS: readonly PlatformAlertKind[] = [
  'health_red',
  'audit_chain_broken',
];

/** The language of an operator's alert mail. */
export const PLATFORM_ALERT_LOCALES = ['en', 'tr'] as const;

export type PlatformAlertLocale = (typeof PLATFORM_ALERT_LOCALES)[number];

export function isPlatformAlertKind(value: unknown): value is PlatformAlertKind {
  return typeof value === 'string' && (PLATFORM_ALERT_KINDS as readonly string[]).includes(value);
}
