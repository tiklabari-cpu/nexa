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
import { fillCannedResponse, type CannedValues } from '@siyahtus/types';
import { useApiClient } from '../../lib/auth-store.js';
import { rankCannedResponses } from './cannedSearch.js';

export interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
  /** `private` is the caller's own personal reply (IN-06); absent from an older server. */
  visibility?: 'all' | 'group' | 'private';
}

/** The list endpoint's answer: the replies, and the workspace's phrase for a variable with no value. */
export interface CannedResponseList {
  items: CannedResponse[];
  /** Absent from an older server; null = the console's default phrase. */
  fallback_text?: string | null;
  /** The workspace name, for `{{company.name}}`; absent from an older server. */
  company_name?: string | null;
}

export function useCannedResponses() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['canned-responses', 'chat'],
    queryFn: () => api.get<CannedResponseList>('/settings/canned-responses?scope=chat'),
    staleTime: 5 * 60_000,
  });
}

/**
 * The `#token` the caret currently sits in, if any.
 *
 * Anchored to the start of a word so a `#` inside a URL or a hex colour does not
 * open the picker mid-sentence, and only ever looks at text *before* the caret —
 * an agent editing earlier in the message should not be interrupted. Any
 * Unicode letter counts (IN-06): the token is a search now, not only a
 * shortcut, so `#çekim` keeps the picker open instead of closing it at `ç`.
 */
export function activeShortcutQuery(
  value: string,
  caret: number,
): { query: string; from: number } | null {
  const upToCaret = value.slice(0, caret);
  const match = /(^|\s)#([\p{L}\p{N}_-]*)$/u.exec(upToCaret);
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

/**
 * {@link applyShortcut} for a saved reply with its variables filled (IN-06):
 * the finished text goes in, and the selection lands on the first fallback
 * phrase — a variable the composer had no value for — so the agent sees it
 * highlighted and can overtype it. With no fallback the caret sits after the
 * reply, as before.
 */
export function insertCannedReply(
  value: string,
  caret: number,
  from: number,
  reply: string,
  values: CannedValues,
  fallback: string,
): { text: string; selectionStart: number; selectionEnd: number } {
  const filled = fillCannedResponse(reply, values, fallback);
  const result = applyShortcut(value, caret, from, filled.text);
  const first = filled.fallbacks[0];
  if (!first)
    return { text: result.text, selectionStart: result.caret, selectionEnd: result.caret };
  return { text: result.text, selectionStart: from + first.start, selectionEnd: from + first.end };
}

export function useMatchingResponses(
  responses: CannedResponse[] | undefined,
  query: string | null,
): CannedResponse[] {
  return useMemo(() => {
    if (query === null || !responses) return [];
    return rankCannedResponses(responses, query);
  }, [responses, query]);
}
