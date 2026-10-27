/**
 * Catalogue layout (copied from apps/web, tm 389.6).
 *
 * Messages live one file per screen area — `locales/<locale>/<namespace>.ts` — holding
 * *fully-qualified* keys, so `t('nav.dashboard')` reads the same from any component and moving
 * a key between files never renames it. Two invariants keep the split honest:
 *
 *  - **No duplicate keys.** Merging is a plain object spread, so a key repeated in two
 *    namespaces would take whichever value was merged last. `mergeNamespaces` throws instead,
 *    at import time.
 *  - **Keys live in the file that owns their prefix** (`NAMESPACE_PREFIXES`), checked by
 *    `i18n-coverage.test.ts`.
 *
 * The root panel starts with three namespaces (the dashboard, 389.8, is the fourth; support and
 * workspaces, 389.9, the fifth and sixth; accounts, 389.11, the seventh; settings, 389.13, the eighth); each later page (389.8–389.20) adds its own
 * here and in both locale folders, which keeps the windows that build them out of each
 * other's files.
 */

/** A catalogue, or one namespace of one: fully-qualified key → text. */
export type Messages = Readonly<Record<string, string>>;

export const NAMESPACES = [
  'accounts',
  'admins',
  'auth',
  'common',
  'dashboard',
  'operations',
  'security',
  'settings',
  'shell',
  'support',
  'workspaces',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** Which key prefixes each namespace file owns. `shell` also holds the side menu (`nav.*`). */
export const NAMESPACE_PREFIXES: Record<Namespace, readonly string[]> = {
  accounts: ['accounts.'],
  admins: ['admins.'],
  auth: ['auth.'],
  common: ['common.', 'ui.'],
  dashboard: ['dashboard.'],
  settings: ['settings.'],
  operations: ['operations.'],
  security: ['security.'],
  shell: ['shell.', 'nav.'],
  support: ['support.'],
  workspaces: ['workspaces.'],
};

/**
 * Flatten a locale's namespaces into the single lookup table `t()` reads. Throws on a
 * duplicate key, naming both the key and the namespace that repeated it.
 */
export function mergeNamespaces(locale: string, namespaces: Record<Namespace, Messages>): Messages {
  const merged: Record<string, string> = {};
  for (const namespace of NAMESPACES) {
    for (const [key, value] of Object.entries(namespaces[namespace])) {
      if (key in merged) {
        throw new Error(
          `i18n: duplicate key "${key}" in locale "${locale}" (namespace "${namespace}")`,
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}
