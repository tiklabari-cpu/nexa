/**
 * The side menu, and the one table that says which permission opens which page (tm 389.6).
 *
 * Each later subtask (389.8–389.20) replaces its entry's placeholder page with the real one in
 * `App.tsx`; the entry itself — path, label, permission — stays here. A permission is a key of
 * `PLATFORM_PERMISSIONS` (`@siyahtus/types`), the same table the server's gate reads, so the
 * menu cannot name a permission the server does not know (`navigation.test.ts` holds the two
 * together). The menu hides what a role cannot open and the route refuses it; neither is the
 * rule — the server's gate is.
 */
import { PLATFORM_PERMISSIONS, type PlatformPermission } from '@siyahtus/types';

export interface NavItem {
  id: string;
  path: string;
  /** Catalogue key of the menu label and the page title. */
  labelKey: string;
  /** Catalogue key of the line under the page title. */
  descriptionKey: string;
  permission: PlatformPermission;
}

/**
 * One entry per page. The path and both catalogue keys are derived from the id, so the three
 * never drift — and no `'/admins'` string literal sits in the client source, where the
 * endpoint-ui audit (`scripts/audit/endpoint-ui.cjs`) would read it as a call to the platform
 * API's `/admins` route: a page address and an API path are different things.
 */
function entry(id: string, permission: PlatformPermission): NavItem {
  return {
    id,
    path: `/${id}`,
    labelKey: `nav.${id}`,
    descriptionKey: `shell.pages.${id}.description`,
    permission,
  };
}

export const NAV_ITEMS: readonly NavItem[] = [
  entry('dashboard', 'dashboard.read'),
  entry('workspaces', 'workspaces.read'),
  entry('accounts', 'accounts.read'),
  entry('billing', 'billing.read'),
  entry('usage', 'usage.read'),
  entry('settings', 'settings.read'),
  entry('ai', 'ai.read'),
  entry('operations', 'operations.read'),
  entry('audit', 'audit.read'),
  entry('security', 'security.read'),
  entry('admins', 'admins.read'),
  // "Look a workspace up and enter it as its owner": the write permission is the gate, there
  // is no read-only support view.
  entry('support', 'support.impersonate'),
];

/** What a role can open, in menu order. */
export function visibleNavItems(permissions: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission));
}

/** Whether `permission` is one the server knows — for the test that holds the two tables together. */
export function isKnownPermission(permission: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLATFORM_PERMISSIONS, permission);
}
