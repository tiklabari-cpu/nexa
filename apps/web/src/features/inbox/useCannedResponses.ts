/**
 * Saved replies for the composer's `#` picker.
 *
 * Long-lived in cache: the list changes when an admin edits Settings, which is
 * rare, and refetching on every keystroke of a `#` prefix would put an agent's
 * typing speed against their own rate limit. Settings invalidates this key when
 * it changes something, so a new shortcut still appears without a reload.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApiClient } from '../../lib/auth-store.js';

export interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
}

export function useCannedResponses() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['canned-responses', 'chat'],
    queryFn: () => api.get<{ items: CannedResponse[] }>('/settings/canned-responses?scope=chat'),
    staleTime: 5 * 60_000,
  });
}

/**
 * The `#token` the caret currently sits in, if any.
 *
 * Anchored to the start of a word so a `#` inside a URL or a hex colour does not
 * open the picker mid-sentence, and only ever looks at text *before* the caret —
 * an agent editing earlier in the message should not be interrupted.
 */
export function activeShortcutQuery(
  value: string,
  caret: number,
): { query: string; from: number } | null {
  const upToCaret = value.slice(0, caret);
  const match = /(^|\s)#([A-Za-z0-9_-]*)$/.exec(upToCaret);
  if (!match) return null;

  const query = match[2] ?? '';
  return { query, from: caret - query.length - 1 };
}

/** Replaces the `#token` under the caret with the reply, leaving a trailing space. */
export function applyShortcut(
  value: string,
  caret: number,
  from: number,
  replacement: string,
): { text: string; caret: number } {
  const before = value.slice(0, from);
  const after = value.slice(caret);
  const inserted = `${replacement} `;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

export function useMatchingResponses(
  responses: CannedResponse[] | undefined,
  query: string | null,
): CannedResponse[] {
  return useMemo(() => {
    if (query === null || !responses) return [];
    const needle = query.toLowerCase();
    return responses.filter((r) => r.shortcut.toLowerCase().startsWith(needle)).slice(0, 6);
  }, [responses, query]);
}
