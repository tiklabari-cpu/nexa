/**
 * Availability and agent activity (RP-03 · tm 370): the closed vocabulary
 * behind `agent_presence_events.source`, and the states the two reports
 * `GET /reports/availability` and `GET /reports/agent-activity` draw.
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle.
 */

/**
 * What wrote a row of the presence log (`agent_presence_events.source`):
 *
 *   - `manual`       — the agent chose the status (`PUT /agents/me/routing-status`);
 *                      also every row written before the column existed;
 *   - `disconnect`   — the RTM tolerance ran out after the agent's last socket
 *                      closed (WG-03 · tm 340.3): the browser was closed or the
 *                      connection dropped, and the agent went `offline`;
 *   - `unresponsive` — the chat-inactivity sweep paused an agent who did not
 *                      answer an assigned chat (`not_accepting_chats`, tm 340.2);
 *   - `suspension`   — suspending or reinstating the member (`offline`, or the
 *                      status they still hold);
 *   - `login`        — a status set by signing in. No path writes it today; the
 *                      value is held so an "online on sign-in" setting is no
 *                      migration.
 *
 * The database CHECK `agent_presence_events_source_check` lists exactly these.
 */
export const PRESENCE_SOURCES = [
  'manual',
  'disconnect',
  'unresponsive',
  'suspension',
  'login',
] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

export function isPresenceSource(value: unknown): value is PresenceSource {
  return typeof value === 'string' && (PRESENCE_SOURCES as readonly string[]).includes(value);
}

/**
 * The state a stretch of an agent's day is drawn in. Four come from the log:
 *
 *   - `accepting`     — `accepting_chats`: routing may give them a chat;
 *   - `not_accepting` — `not_accepting_chats`: signed in, taking no new chats;
 *   - `offline`       — `offline` the agent chose (or a suspension imposed);
 *   - `disconnected`  — `offline` written by a dropped connection
 *                       (`source = 'disconnect'`): "bağlantı yok".
 *
 * The fifth, `unknown`, is the stretch before the agent's first row: the log
 * records changes, so before the first one nothing is known — which is not the
 * claim that they were away.
 */
export const ACTIVITY_STATES = [
  'accepting',
  'not_accepting',
  'offline',
  'disconnected',
  'unknown',
] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

/** The longest window `GET /reports/availability` reads, in days. */
export const AVAILABILITY_MAX_DAYS = 31;

/** `GET /reports/agent-activity` page size: default and ceiling. */
export const AGENT_ACTIVITY_PAGE_DEFAULT = 25;
export const AGENT_ACTIVITY_PAGE_MAX = 100;
