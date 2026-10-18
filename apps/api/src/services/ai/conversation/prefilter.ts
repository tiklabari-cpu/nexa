/**
 * The catalogue narrowing (tm 297.3 · SiyahTuş analysis AI-05 §2): past
 * {@link PREFILTER_ABOVE} procedures, the understanding call is offered only
 * the {@link PREFILTER_KEEP} whose example sentences lie nearest the player's
 * message — and always the locked ones (AI-15) and the one in progress.
 *
 * Pure: the nearness is `ProcedureExamples.rank`'s, read from the turn's one
 * embedding; here, which entries that leaves. One rule beyond the analysis
 * text: **a procedure the ranking does not know is kept.** It has no examples
 * in the message's embedding space — saved before the narrowing existed,
 * saved while the provider was failing, or written in another space — and a
 * procedure that cannot be judged is not one to drop: the player could then
 * never reach it. A narrowing that knows nothing keeps everything.
 *
 * The kept entries stay in the catalogue's own order (locked, priority, name),
 * so the prompt is as stable as before.
 */
import { PREFILTER_KEEP, type RankedSkill } from '../procedure-examples.js';
import type { CatalogueEntry } from './procedure/understanding.js';

export { PREFILTER_KEEP };

/** A catalogue larger than this is narrowed (AI-05 §2: "15'ten büyükse"). */
export const PREFILTER_ABOVE = 15;

/** What the decision record keeps of a narrowing: counts, no words. */
export interface PrefilterRecord {
  /** Procedures in the catalogue before. */
  procedures: number;
  /** Offered to the call after. */
  offered: number;
  /** Of those, kept for want of examples in the turn's space. */
  unranked: number;
  /** How the nearness was searched. */
  strategy: 'exact' | 'approximate' | 'approximate-then-exact';
}

export interface Narrowed {
  catalogue: CatalogueEntry[];
  /** Absent when the catalogue was not larger than {@link PREFILTER_ABOVE}. */
  record?: PrefilterRecord;
}

/** Whether a catalogue of this many procedures is narrowed. */
export function needsPrefilter(catalogue: readonly CatalogueEntry[]): boolean {
  return catalogue.length > PREFILTER_ABOVE;
}

/**
 * The entries the call is offered: the {@link PREFILTER_KEEP} nearest by
 * `ranked` (nearest first, as `rank` returns it), every locked one, the
 * active one, and every one `ranked` does not name.
 */
export function narrowCatalogue(input: {
  catalogue: readonly CatalogueEntry[];
  ranked: readonly RankedSkill[];
  activeKey: string | null;
  strategy: PrefilterRecord['strategy'];
}): Narrowed {
  const { catalogue } = input;
  if (!needsPrefilter(catalogue)) return { catalogue: [...catalogue] };
  const keys = new Set(catalogue.map((entry) => entry.key));
  const ranked = input.ranked.filter((item) => keys.has(item.skillId));
  const rankedKeys = new Set(ranked.map((item) => item.skillId));
  const nearest = new Set(ranked.slice(0, PREFILTER_KEEP).map((item) => item.skillId));
  const kept = catalogue.filter(
    (entry) =>
      nearest.has(entry.key) ||
      entry.locked ||
      entry.key === input.activeKey ||
      !rankedKeys.has(entry.key),
  );
  return {
    catalogue: kept,
    record: {
      procedures: catalogue.length,
      offered: kept.length,
      unranked: kept.filter((entry) => !rankedKeys.has(entry.key)).length,
      strategy: input.strategy,
    },
  };
}

/** One run-log line for a narrowing. */
export function prefilterDetail(record: PrefilterRecord): string {
  return [
    `narrowed ${record.procedures} procedures to ${record.offered}`,
    `the ${PREFILTER_KEEP} nearest by example, locked and active kept`,
    record.unranked > 0 ? `${record.unranked} without examples in this space kept` : '',
    record.strategy !== 'exact' ? record.strategy : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
