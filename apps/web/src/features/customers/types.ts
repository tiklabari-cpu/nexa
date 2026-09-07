import type { CustomFieldValue } from '@nexa/types';

export type Segment = 'all' | 'leads' | 'recent' | 'banned';

export interface CustomerSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  country: string | null;
  is_lead: boolean;
  banned: boolean;
  /** Counted from conversations by the API, not read from a stored total. */
  chats_count: number;
  tickets_count: number;
  last_activity_at: string | null;
  created_at: string;
  /**
   * The contact custom fields flagged `show_in_table` (FR-MOD-03.2.3), with
   * this customer's values — a subset of the full set `custom_fields` (below)
   * carries on the detail response. Empty when the workspace has flagged none.
   */
  table_custom_fields: CustomFieldValue[];
}

export interface Visit {
  id: string;
  came_from: string | null;
  /** Sanitised server-side (`visitedPagesOf`) — a malformed entry is dropped, never returned. */
  pages: Array<{ url: string; at?: string }>;
  os: string | null;
  browser: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  banned_at: string | null;
  /** True total — `visits` below is capped at the most recent entries. */
  visits_count: number;
  /** Teams this visitor's conversations have been routed to, deduplicated. */
  groups: Array<{ id: number; name: string }>;
  visits: Visit[];
  chats: Array<{
    id: string;
    active: boolean;
    created_at: string;
    last_event_at: string | null;
  }>;
  /** Custom fields defined for contacts, with this contact's values (FR-MOD-08.7.6). */
  custom_fields: CustomFieldValue[];
}
