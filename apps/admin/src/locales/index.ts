import { en, enNamespaces } from './en/index.js';
import { tr, trNamespaces } from './tr/index.js';
import type { Messages, Namespace } from './merge.js';

export { NAMESPACES, NAMESPACE_PREFIXES, mergeNamespaces } from './merge.js';
export type { Messages, Namespace } from './merge.js';

/**
 * Every locale the panel ships, flattened. `i18n.ts` binds this to its `Locale` type, so adding
 * a directory here without teaching `Locale` about it — or the reverse — is a type error.
 */
export const CATALOGUES = { en, tr } satisfies Record<string, Messages>;

/** The same catalogues still split by namespace — `i18n-coverage.test.ts` reads this. */
export const NAMESPACED_CATALOGUES = { en: enNamespaces, tr: trNamespaces } satisfies Record<
  string,
  Record<Namespace, Messages>
>;
