/**
 * Catalogue layout (NFR-I18N2).
 *
 * The panel's messages live one file per screen area — `locales/<locale>/<namespace>.ts`
 * — rather than in one flat object. The split is organisational only: a
 * namespace file holds *fully-qualified* keys, so `t('nav.inbox')` reads the
 * same from any component and moving a key between files never renames it.
 *
 * Why files at all: translating the console is thirteen tasks across as many
 * windows (I18N-b … I18N-m). One object would mean thirteen windows editing the
 * same region of the same file, and the first merge conflict would be resolved
 * by whoever noticed it — which is how a catalogue silently loses half a
 * screen's Turkish. A file per area gives each window its own surface.
 *
 * Two invariants keep the split honest, and both fail loudly rather than
 * quietly:
 *
 *  - **No duplicate keys.** Merging is a plain object spread, so a key repeated
 *    in two namespaces would take whichever value happened to be merged last —
 *    an invisible, order-dependent bug. `mergeNamespaces` throws instead, at
 *    import time, which means at the app's first render and at the first test.
 *  - **Keys live in the file that owns their prefix** (`NAMESPACE_PREFIXES`).
 *    Checked by `i18n-coverage.test.ts` rather than at runtime: a misfiled key
 *    still *works*, it is only hard to find, so paying for the check on every
 *    boot would buy nothing.
 */

/** A catalogue, or one namespace of one: fully-qualified key → text. */
export type Messages = Readonly<Record<string, string>>;

/**
 * The screen areas the console is translated in. One file per entry per locale;
 * `en` and `tr` carry the same filenames even while a namespace is still empty,
 * so the window that translates that area has somewhere to write.
 */
export const NAMESPACES = [
  'apps',
  'auth',
  'billing',
  'common',
  'customers',
  'home',
  'inbox',
  'playbook',
  'reports',
  'settings',
  'shell',
  'team',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * Which key prefixes each namespace file owns.
 *
 * Usually just the namespace's own name. `shell` is the exception: the rail
 * (`nav.*`) and the command palette (`palette.*`) are chrome that surrounds
 * every screen and is translated as one unit, and renaming ~30 live keys to
 * satisfy a filing rule would be churn with no reader on the other end.
 * `customers` is the second exception (I18N-d, tm 133.4): the task groups four
 * screens — Contacts, the live Real-time board, Campaigns and Goals — plus the
 * `custom-fields` control they share into one file (`locales/{en,tr}/customers.ts`),
 * so each keeps its own prefix rather than forcing every key under `customers.*`.
 */
export const NAMESPACE_PREFIXES: Record<Namespace, readonly string[]> = {
  apps: ['apps.'],
  auth: ['auth.'],
  billing: ['billing.'],
  common: ['common.'],
  customers: ['customers.', 'customFields.', 'traffic.', 'campaigns.', 'goals.'],
  home: ['home.'],
  inbox: ['inbox.'],
  playbook: ['playbook.'],
  reports: ['reports.'],
  settings: ['settings.'],
  shell: ['shell.', 'nav.', 'palette.'],
  team: ['team.'],
};

/**
 * Flatten a locale's namespaces into the single lookup table `t()` reads.
 *
 * Throws on a duplicate key, naming both the key and the namespace that
 * repeated it — the message has to be enough to fix it, because this fires
 * during module initialisation where there is no stack worth reading.
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
