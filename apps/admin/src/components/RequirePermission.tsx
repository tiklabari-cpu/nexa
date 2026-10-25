/**
 * Keeps a page from rendering for a role that does not hold its permission (tm 389.6).
 *
 * Courtesy, not security: the page behind it fetches through the same API every request goes
 * through, and the server answers 403 for a role it does not admit, whatever this component
 * thinks. The check exists so a route opened by hand shows the reason instead of a screen of
 * failed requests — and `ForbiddenPage` is also what a page shows when the *server* says no.
 */
import type { ReactElement, ReactNode } from 'react';
import { hasPermission, useAuth } from '../lib/auth-store.js';
import { ForbiddenPage } from './ForbiddenPage.js';

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}): ReactElement {
  const me = useAuth((s) => s.me);
  if (!hasPermission(me, permission)) return <ForbiddenPage role={me?.admin.role} />;
  return <>{children}</>;
}
