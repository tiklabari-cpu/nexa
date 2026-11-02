/**
 * The chips the composer offers for what is happening in the conversation
 * (IN-07 · tm 364) — the hook around the pure `eventSuggestions.ts`.
 *
 * It reads the transcript from the cache the open conversation already fills
 * (passively: no request of its own), the chat for its assignee and its rating,
 * the saved replies the `#` picker reads, the player's promotion block (EN-01)
 * and the member's own "close event suggestions" switch. What it returns is the
 * row — texts ready to drop into the reply box — and the occurrences behind it,
 * so the composer can mark them done when the agent picks, dismisses or types.
 *
 * **A timer, not a poll.** The one event that is a duration, `customer_idle`,
 * is armed for the instant the player's silence reaches the workspace's
 * threshold; until then the hook costs nothing.
 */
import { hashKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CUSTOMER_IDLE_SECONDS,
  fillCannedResponse,
  hasAnyScope,
  type CannedValues,
  type SuggestEvent,
  type UiPreferences,
} from '@siyahtus/types';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useCustomerRiskFlags } from '../risk/useRiskFlags.js';
import { UI_PREFERENCES_QUERY_KEY } from '../settings/SettingsNav.js';
import {
  detectActiveEvents,
  idleDueAt,
  pickEventReplies,
  type ActiveSuggestEvent,
  type EventReply,
  type EventTurn,
} from './eventSuggestions.js';
import { useEventSuggestionStore } from './eventSuggestionState.js';
import type { ReplyChip } from './replySuggestions.js';
import { useChat, eventsKey, flattenTranscript, type TranscriptCache } from './useInbox.js';
import type { CannedResponseList } from './useCannedResponses.js';

/** A stable stand-in for "no scopes": a selector returning a fresh `[]` re-renders forever. */
const NO_SCOPES: readonly string[] = [];

/** The longest a single `setTimeout` may wait (a 32-bit signed int of milliseconds). */
const MAX_TIMER_MS = 2_147_000_000;

/**
 * The member's own "close event suggestions for me" switch. On until the server
 * says otherwise — and for a member who may not read their preferences, which
 * is the same answer a fresh membership gets.
 */
export function useEventSuggestionsPreference(): {
  enabled: boolean;
  canToggle: boolean;
  toggle: () => void;
  saving: boolean;
} {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? NO_SCOPES);
  const canRead = hasAnyScope(scopes, ['agents--my:ro', 'agents--all:ro']);
  const canToggle = hasAnyScope(scopes, ['agents--my:rw', 'agents--all:rw']);

  const query = useQuery({
    queryKey: UI_PREFERENCES_QUERY_KEY,
    queryFn: () => api.get<UiPreferences>('/agents/me/ui-preferences'),
    enabled: canRead,
  });
  const enabled = query.data?.suggestions_event_enabled !== false;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      api.put<UiPreferences>('/agents/me/ui-preferences', { suggestions_event_enabled: next }),
    onSuccess: (prefs) => queryClient.setQueryData(UI_PREFERENCES_QUERY_KEY, prefs),
  });

  return {
    enabled,
    canToggle,
    toggle: () => mutation.mutate(!enabled),
    saving: mutation.isPending,
  };
}

/**
 * The open conversation's transcript, oldest first, read from the cache the
 * Transcript pane fills — and only read: this is a cache *subscription*, not a
 * query observer. An observer on that key (even one that never fetches) is
 * counted among the query's observers and its options can replace the paged
 * query's own, which broke the refetch after a reopen. Undefined until the first
 * page has landed.
 */
function useCachedTranscript(chatId: string): EventTurn[] | undefined {
  const queryClient = useQueryClient();
  const [cache, setCache] = useState(() =>
    queryClient.getQueryData<TranscriptCache>(eventsKey(chatId)),
  );
  useEffect(() => {
    const hash = hashKey(eventsKey(chatId));
    setCache(queryClient.getQueryData<TranscriptCache>(eventsKey(chatId)));
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== hash) return;
      setCache(event.query.state.data as TranscriptCache | undefined);
    });
  }, [queryClient, chatId]);
  return useMemo(() => (cache ? flattenTranscript(cache) : undefined), [cache]);
}

export interface EventChips {
  /** The chips, in the order they are offered; empty when nothing is active. */
  chips: ReplyChip[];
  /** The occurrences behind `chips` — what `consume` marks as done. */
  keys: string[];
  /** The events behind the chips, for a test and for `data-` attributes. */
  active: ActiveSuggestEvent[];
}

export function useEventChips({
  chatId,
  replies,
  values,
  fallback,
  enabled,
}: {
  chatId: string;
  replies: CannedResponseList | undefined;
  values: CannedValues;
  fallback: string;
  /** False while the composer cannot be answered in (archived, window closed, …). */
  enabled: boolean;
}): EventChips {
  const agentId = useAuth((s) => s.agent?.account_id ?? null);
  const preference = useEventSuggestionsPreference();
  const chat = useChat(chatId);
  const used = useEventSuggestionStore((s) => s.used);
  const ratedPush = useEventSuggestionStore((s) => Boolean(s.rated[chatId]));

  const turns = useCachedTranscript(chatId);

  // EN-01: the server's answer for the player, over every flag of theirs. Until
  // it has answered — or when this caller may not read it — a promotion reply is
  // withheld: a suggestion is the wrong place to guess.
  const customerId = chat.data?.customer_id ?? '';
  const risk = useCustomerRiskFlags(customerId);
  const promoSuppressed = risk.data?.promo_suppressed ?? true;

  const idleSeconds = replies?.customer_idle_seconds ?? DEFAULT_CUSTOMER_IDLE_SECONDS;

  // Re-evaluated when the player's silence reaches the threshold.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !turns) return;
    const due = idleDueAt(turns, idleSeconds);
    if (due === null) return;
    const wait = due - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(wait + 25, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [enabled, turns, idleSeconds]);

  const rating = chat.data?.thread?.rating ?? null;
  const threadId = chat.data?.thread?.id ?? null;

  return useMemo<EventChips>(() => {
    const none: EventChips = { chips: [], keys: [], active: [] };
    if (!enabled || !preference.enabled || !turns || !replies) return none;
    const detected = detectActiveEvents({
      agentId,
      assigneeId: chat.data?.thread?.assignee_id ?? null,
      turns,
      active: chat.data?.active ?? true,
      idleSeconds,
      now: Date.now(),
      rating:
        ratedPush && rating && threadId
          ? { value: rating.value, key: `rated:${threadId}:${rating.rated_at}` }
          : null,
    }).filter((event) => !used[event.key]);
    if (detected.length === 0) return none;

    const picks = pickEventReplies(
      replies.items.map<EventReply>((item) => ({
        id: item.id,
        shortcut: item.shortcut,
        text: item.text,
        suggest_on: (item.suggest_on ?? []) as SuggestEvent[],
        suggest_order: item.suggest_order ?? 0,
        category: item.category ?? 'general',
      })),
      detected,
      { promoSuppressed },
    );
    const chips: ReplyChip[] = [];
    const keys = new Set<string>();
    for (const pick of picks) {
      const text = fillCannedResponse(pick.reply.text, values, fallback).text.trim();
      if (text.length === 0 || chips.some((chip) => chip.text === text)) continue;
      chips.push({ text, source: 'event', event: pick.event.event });
      keys.add(pick.event.key);
    }
    return { chips, keys: [...keys], active: detected };
    // `tick` is the idle timer's nudge: the clock is read inside, so it must re-run.
  }, [
    enabled,
    preference.enabled,
    turns,
    replies,
    agentId,
    chat.data,
    idleSeconds,
    rating,
    threadId,
    ratedPush,
    used,
    promoSuppressed,
    values,
    fallback,
    tick,
  ]);
}
