/** Real-time traffic — the live-visitor board (FR-MOD-03.1.3). */

export type TrafficActivity =
  'browsing' | 'queued' | 'waiting' | 'chatting' | 'supervised' | 'invited';

/** Who a visitor is currently talking to — the "Chatting with" column. */
export interface TrafficRespondent {
  kind: 'human' | 'ai';
  name: string;
  avatar_url: string | null;
}

export interface TrafficVisitor {
  customer_id: string;
  name: string | null;
  email: string | null;
  activity: TrafficActivity;
  chat_id: string | null;
  chatting_with: TrafficRespondent | null;
  last_activity_at: string | null;
}
