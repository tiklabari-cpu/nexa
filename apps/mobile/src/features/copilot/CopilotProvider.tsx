/**
 * Where the Copilot API is built from the session's client — the one place
 * that knows `useServices()` exists, mirroring `features/reports/ReportsProvider`.
 * Mounted above the Inbox stack alongside `InboxProvider`, since Copilot is
 * only reachable from a chat already open there.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createCopilotApi } from './api';
import type { CopilotApi } from './api';
import { CopilotContext } from './context';
import { useServices } from '../../app/services';

export interface CopilotProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: CopilotApi;
}

export function CopilotProvider({ api, children }: CopilotProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createCopilotApi(client), [api, client]);
  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}
