/**
 * The one request the Reports screen makes, kept apart the same way
 * `features/customers/api.ts` is: the path literal lives here, not in the
 * component, so a screen — and a test of one — can hand in a plain object
 * instead of a real session and a real fetch.
 *
 * No `from`/`to`/`baseline` query — `13.7-h` KAPSAM is the Overview KPI cards
 * only, not the range/benchmark controls the web Reports page also carries
 * (out of scope, same trim `13.7-g` applied to the Customers detail panel).
 * Omitting them lets the API default apply: the last 30 days.
 */
import type { SessionApiClient } from '../../api/client';
import type { ReportsOverview } from './types';

export interface ReportsApi {
  getOverview(signal?: AbortSignal): Promise<ReportsOverview>;
}

export function createReportsApi(client: SessionApiClient): ReportsApi {
  return {
    getOverview(signal) {
      return client.request('get', '/reports/overview', {
        ...(signal ? { signal } : {}),
      });
    },
  };
}
