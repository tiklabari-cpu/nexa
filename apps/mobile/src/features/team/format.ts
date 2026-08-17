/**
 * Display formatting local to this feature — mirrors the wording
 * `apps/web/src/features/team` uses, not its code: a web module cannot be
 * imported across the workspace boundary into a Metro bundle.
 */
import type { WorkScheduleDay } from '@nexa/types';

import type { Agent } from './types';

const ROLE_LABEL: Record<Agent['role'], string> = {
  owner: 'Owner',
  viceowner: 'Vice Owner',
  admin: 'Admin',
  agent: 'Agent',
};

export function formatRole(role: Agent['role']): string {
  return ROLE_LABEL[role];
}

const ROUTING_STATUS_LABEL: Record<Agent['routing_status'], string> = {
  accepting_chats: 'Online',
  not_accepting_chats: 'Away',
  offline: 'Offline',
};

export function formatRoutingStatus(status: Agent['routing_status']): string {
  return ROUTING_STATUS_LABEL[status];
}

export const DAY_LABEL: Record<WorkScheduleDay, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};
