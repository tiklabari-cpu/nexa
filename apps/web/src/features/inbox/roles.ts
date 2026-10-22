import { AGENT_ROLES, roleAtLeast } from '@siyahtus/types';

/** Roles that may seize a chat from whoever holds it — mirrors the route's own gate. */
export const SUPERVISOR_ROLES: ReadonlySet<string> = new Set(
  AGENT_ROLES.filter((role) => roleAtLeast(role, 'admin')),
);
