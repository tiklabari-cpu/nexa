import { en, enNamespaces } from './en/index.js';
import { tr, trNamespaces } from './tr/index.js';
import type { Messages, Namespace } from './merge.js';

export { NAMESPACES, NAMESPACE_PREFIXES, mergeNamespaces } from './merge.js';
export type { Messages, Namespace } from './merge.js';

/**
 * Every locale the panel ships, flattened. `i18n.ts` binds this to its `Locale`
 * type, so adding a directory here without teaching `Locale` about it — or the
 * reverse — is a type error rather than a locale that silently never loads.
 */
export const CATALOGUES = { en, tr } satisfies Record<string, Messages>;

/**
 * The same catalogues still split by namespace. Only `i18n-coverage.test.ts`
 * reads this: it needs to know *which file* a key came from to report a missing
 * translation as "add it to `locales/tr/reports.ts`" rather than as a bare key.
 */
export const NAMESPACED_CATALOGUES = { en: enNamespaces, tr: trNamespaces } satisfies Record<
  string,
  Record<Namespace, Messages>
>;
