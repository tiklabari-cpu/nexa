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
 * "Run this scheduler job now" (tm 389.14): `{ type: 'job.run', name, request_id }`.
 * Every tenant process whose scheduler is on hears it; the one that wins the
 * `request_id` claim runs the job (`services/ops/ops-channel.ts`).
 */
export const PLATFORM_JOB_RUN = 'job.run';
