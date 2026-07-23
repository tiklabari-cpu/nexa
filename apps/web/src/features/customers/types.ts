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
}

export interface Visit {
  id: string;
  came_from: string | null;
  pages: Array<{ url?: string; at?: string }>;
  os: string | null;
  browser: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  banned_at: string | null;
  visits: Visit[];
  chats: Array<{
    id: string;
    active: boolean;
    created_at: string;
    last_event_at: string | null;
  }>;
}
