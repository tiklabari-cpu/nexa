/**
 * The Reports API, kept apart from the provider that builds it — same split
 * as the Customers context. A screen needs the one request it can make; it
 * does not need the session or the transport `ReportsProvider` assembles one
 * from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { ReportsApi } from './api';

export const ReportsContext = createContext<ReportsApi | null>(null);

export function useReportsApi(): ReportsApi {
  const api = useContext(ReportsContext);
  if (api === null) {
    throw new Error('useReportsApi must be called within a ReportsProvider');
  }
  return api;
}
