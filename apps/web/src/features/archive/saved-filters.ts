/**
 * Saved Archive filters (AR-02-S3 · tm 336.2): a person keeps a filter under a
 * name ("Bad ratings, Finance") and applies it again later. They are **personal**:
 * kept in this browser under the signed-in account, never shared with the team —
 * sharing a filtered list is the address (`archive-filters.ts`), which carries ids
 * only. Like Inbox's saved filters and Reports' saved views, and for the same
 * reason there is no server table behind them.
 *
 * A saved filter holds the filter as the address spells it (ids and enum words),
 * minus the dates: "yesterday" saved today would be a stale pair of days
 * tomorrow, and the range is what a person changes most. Applying one keeps the
 * dates already chosen.
 */
import { useState } from 'react';
import { filterParams, isFiltered, readFilters, type ArchiveFilters } from './archive-filters.js';

export const SAVED_ARCHIVE_FILTER_NAME_MAX = 40;
export const SAVED_ARCHIVE_FILTER_MAX = 20;

export interface SavedArchiveFilter {
  id: string;
  name: string;
  /** The filters as an address query string (`rating=bad&group_id=3`), dates left out. */
  query: string;
}

const STORAGE_PREFIX = 'siyahtus.archive.saved-filters.';

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The filters without their dates — what is kept. */
export function withoutDates(filters: ArchiveFilters): ArchiveFilters {
  return { ...filters, dateFrom: null, dateTo: null };
}

/** A saved filter applied over the filters on screen: its choices, this screen's dates. */
export function applySaved(saved: SavedArchiveFilter, current: ArchiveFilters): ArchiveFilters {
  const loaded = readFilters(new URLSearchParams(saved.query));
  return { ...loaded, dateFrom: current.dateFrom, dateTo: current.dateTo };
}

function isSaved(value: unknown): value is SavedArchiveFilter {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' && typeof v['name'] === 'string' && typeof v['query'] === 'string'
  );
}

/** Keep only the keys a filter owns, so a hand-edited store cannot smuggle anything into the address. */
function cleanQuery(query: string): string {
  const read = readFilters(new URLSearchParams(query));
  return filterParams(withoutDates(read)).toString();
}

export function loadSavedArchiveFilters(
  accountId: string | null,
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): SavedArchiveFilter[] {
  if (!accountId) return [];
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + accountId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSaved)
      .slice(0, SAVED_ARCHIVE_FILTER_MAX)
      .map((entry) => ({ ...entry, query: cleanQuery(entry.query) }));
  } catch {
    return [];
  }
}

export function persistSavedArchiveFilters(
  accountId: string | null,
  filters: SavedArchiveFilter[],
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  if (!accountId) return;
  try {
    storage?.setItem(STORAGE_PREFIX + accountId, JSON.stringify(filters));
  } catch {
    // A filter that cannot be remembered is not worth failing the click over.
  }
}

/** Why a name cannot be saved, or null. */
export function saveBlocked(
  saved: readonly SavedArchiveFilter[],
  name: string,
  filters: ArchiveFilters,
): 'name' | 'empty' | 'full' | 'duplicate' | null {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > SAVED_ARCHIVE_FILTER_NAME_MAX) return 'name';
  if (!isFiltered(withoutDates(filters))) return 'empty';
  if (saved.length >= SAVED_ARCHIVE_FILTER_MAX) return 'full';
  if (saved.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) return 'duplicate';
  return null;
}

export function useSavedArchiveFilters(accountId: string | null): {
  saved: SavedArchiveFilter[];
  save: (name: string, filters: ArchiveFilters) => boolean;
  remove: (id: string) => void;
} {
  const [saved, setSaved] = useState<SavedArchiveFilter[]>(() =>
    loadSavedArchiveFilters(accountId),
  );

  const commit = (next: SavedArchiveFilter[]): void => {
    setSaved(next);
    persistSavedArchiveFilters(accountId, next);
  };

  return {
    saved,
    save: (name, filters) => {
      if (saveBlocked(saved, name, filters) !== null) return false;
      const id = `sf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      commit([
        ...saved,
        { id, name: name.trim(), query: filterParams(withoutDates(filters)).toString() },
      ]);
      return true;
    },
    remove: (id) => commit(saved.filter((entry) => entry.id !== id)),
  };
}
