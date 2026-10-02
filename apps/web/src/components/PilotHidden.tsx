/**
 * A module the public pilot does not offer, closed at its address (tm 257.2 ·
 * ADR docs/adr/pilot-public-readiness.md K-d).
 *
 * The rail, the palette and the settings navigation already leave the door
 * out (`pilotHidden`); this is for the bookmark, the old link and the typed
 * URL. Like any address outside the product it lands in the inbox — the same
 * `Navigate` `App.tsx` uses for `/app` itself — rather than on a page whose
 * every action the API would refuse.
 *
 * Until `GET /deployment` has answered, `useDeployment` says "not the pilot",
 * so the page renders and then leaves. That only ever shows something, never
 * opens anything: the API refuses the module's writes on its own.
 */
import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useDeployment } from '../lib/deployment.js';

export function PilotHidden({ children }: { children: ReactNode }): ReactElement {
  const { pilot_mode: pilotMode } = useDeployment();
  if (pilotMode) return <Navigate to="/app/inbox" replace />;
  return <>{children}</>;
}
