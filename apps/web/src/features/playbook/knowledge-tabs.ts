/**
 * Which sub-tab a knowledge source belongs to, and how to slice the list.
 *
 * Knowledge is one flat list of sources, but an admin reasons about it by kind:
 * the sites the AI crawled, the files they uploaded, the articles they wrote,
 * the FAQ they curated. The sub-tabs are a pure partition over
 * `KnowledgeSource.type` — every source lands under exactly one kind tab, so
 * `All = Websites ∪ Files ∪ Articles ∪ FAQ` with nothing hidden and nothing
 * double-counted (FR-MOD-06.3.1).
 */
import type { KnowledgeSource } from './types.js';

/** The source kinds the schema stores, in the order the tabs read left to right. */
export const KNOWLEDGE_TYPES = ['website', 'file', 'article', 'faq'] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeTab = 'all' | KnowledgeType;

type SourceFacet = Pick<KnowledgeSource, 'type'>;

/**
 * Whether a stored `type` is one the tabs know about. A row with an unexpected
 * type (an older seed, a future kind) still shows under All — it is never lost,
 * only absent from the kind tabs, which is the safe way to fail.
 */
export function isKnowledgeType(type: string): type is KnowledgeType {
  return (KNOWLEDGE_TYPES as readonly string[]).includes(type);
}

/** The subset shown under a tab. `all` passes everything through unchanged. */
export function filterSourcesByTab<T extends SourceFacet>(
  sources: readonly T[],
  tab: KnowledgeTab,
): T[] {
  if (tab === 'all') return [...sources];
  return sources.filter((source) => source.type === tab);
}

/** How many sources sit under each tab, for the counts on the tab labels. */
export function countSourcesByTab(sources: readonly SourceFacet[]): Record<KnowledgeTab, number> {
  const counts: Record<KnowledgeTab, number> = {
    all: sources.length,
    website: 0,
    file: 0,
    article: 0,
    faq: 0,
  };
  for (const source of sources) {
    if (isKnowledgeType(source.type)) counts[source.type] += 1;
  }
  return counts;
}
