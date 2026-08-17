/**
 * The Billing API, kept apart from the provider that builds it — same split
 * as the Team and Playbook contexts. A screen needs the four requests it can
 * make; it does not need the session or the transport `BillingProvider`
 * assembles one from, so a screen — and a test of one — depends on the
 * smaller thing.
 */
import { createContext, useContext } from 'react';

import type { BillingApi } from './api';

export const BillingContext = createContext<BillingApi | null>(null);

export function useBillingApi(): BillingApi {
  const api = useContext(BillingContext);
  if (api === null) {
    throw new Error('useBillingApi must be called within a BillingProvider');
  }
  return api;
}
