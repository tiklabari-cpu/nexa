/**
 * The three requests the Team screens make, kept apart the same way
 * `features/customers/api.ts` is: path literals live here, not scattered
 * across components, so a screen — and a test of one — can hand in a plain
 * object instead of a real session and a real fetch.
 *
 * `listAgents` asks for `status=all` rather than the default `active` slice —
 * the roster's whole point here is "who is online, who is suspended", and the
 * default would silently drop the second half of that question.
 */
import type { SessionApiClient } from '../../api/client';
import type { Agent, AgentWorkSchedule, Group } from './types';

export interface TeamApi {
  listAgents(signal?: AbortSignal): Promise<Agent[]>;
  getAgentWorkSchedule(agentId: string, signal?: AbortSignal): Promise<AgentWorkSchedule>;
  listGroups(signal?: AbortSignal): Promise<Group[]>;
}

export function createTeamApi(client: SessionApiClient): TeamApi {
  return {
    listAgents(signal) {
      return client
        .request('get', '/agents', { query: { status: 'all' }, ...(signal ? { signal } : {}) })
        .then((page) => page.items);
    },

    getAgentWorkSchedule(agentId, signal) {
      return client.request('get', '/agents/{agentId}/work-schedule', {
        params: { agentId },
        ...(signal ? { signal } : {}),
      });
    },

    listGroups(signal) {
      return client
        .request('get', '/groups', { ...(signal ? { signal } : {}) })
        .then((page) => page.items);
    },
  };
}
