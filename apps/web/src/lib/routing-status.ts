/**
 * Changing the caller's own routing status from anywhere but the Team page.
 *
 * `auth-store.setRoutingStatus` writes the server and the auth store, and stops
 * there: the roster (`['team', 'agents']`) is a query, and until now it only
 * learned of the change from the realtime push. A push can be late or lost, and
 * the roster's stale time is 30 s, so a Team screen opened right after the
 * palette paused the agent kept showing "Accepting chats". The two callers (the
 * palette's toggle and the inbox rail's select) share this hook so both refresh
 * the roster from the same place.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, type CurrentAgent } from './auth-store.js';

export function useSetRoutingStatus(): (status: CurrentAgent['routing_status']) => Promise<void> {
  const queryClient = useQueryClient();
  const setRoutingStatus = useAuth((s) => s.setRoutingStatus);

  return useCallback(
    async (status) => {
      // A rejected write throws before this line, so a failed attempt leaves the
      // roster exactly as it was.
      await setRoutingStatus(status);
      void queryClient.invalidateQueries({ queryKey: ['team', 'agents'] });
    },
    [queryClient, setRoutingStatus],
  );
}
