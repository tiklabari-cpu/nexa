/**
 * The Copilot API, kept apart from the provider that builds it — same split
 * as `features/reports/context.ts`. A screen needs the two requests it can
 * make; it does not need the session or the transport `CopilotProvider`
 * assembles one from, so a screen — and a test of one — depends on the
 * smaller thing.
 */
import { createContext, useContext } from 'react';

import type { CopilotApi } from './api';

export const CopilotContext = createContext<CopilotApi | null>(null);

export function useCopilotApi(): CopilotApi {
  const api = useContext(CopilotContext);
  if (api === null) {
    throw new Error('useCopilotApi must be called within a CopilotProvider');
  }
  return api;
}
