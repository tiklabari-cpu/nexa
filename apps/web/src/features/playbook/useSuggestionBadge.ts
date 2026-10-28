/**
 * The reviewers' badge (tm 318.2 · AI-23): how many suggestions wait for the
 * caller to decide. One cheap read (`limit=1` — the list answers `open_count`
 * whatever the page), moved at once by `ai_suggestion_created` through
 * `applyPush`. A caller who reviews nothing gets zero from the server, and a
 * caller the route refuses gets no badge — no retry, like the rail's counts.
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import { SUGGESTION_BADGE_PATH, suggestionKeys, type AiSuggestionList } from './ai-suggestions.js';

export function useSuggestionBadge(enabled = true): number {
  const api = useApiClient();
  const badge = useQuery({
    queryKey: suggestionKeys.badge,
    queryFn: () => api.get<AiSuggestionList>(SUGGESTION_BADGE_PATH),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  const count = badge.data?.open_count;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
}
