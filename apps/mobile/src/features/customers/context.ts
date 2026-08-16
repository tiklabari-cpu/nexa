/**
 * The Customers API, kept apart from the provider that builds it — same split
 * as the inbox's `context.ts`. A screen needs the two requests it can make; it
 * does not need the session or the transport `CustomersProvider` assembles one
 * from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { CustomersApi } from './api';

export const CustomersContext = createContext<CustomersApi | null>(null);

export function useCustomersApi(): CustomersApi {
  const api = useContext(CustomersContext);
  if (api === null) {
    throw new Error('useCustomersApi must be called within a CustomersProvider');
  }
  return api;
}
