/**
 * The queue reports (RP-04 · tm 371): `GET /reports/queue` and
 * `GET /reports/queue-abandonment`, read from the `queue_entries` record that
 * tm 291 started writing (`queue-entry.ts` — how a stay ended).
 *
 * One stay in the queue is one row; a connection that waited twice (a transfer
 * to another team, WG-03's re-queue) is two stays and counts twice. Names follow
 * the identity glossary (ID-01, K1 = A): a row is one connection (nexa thread,
 * "Chat ID" in the panel).
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle.
 */

/**
 * The abandonment report's wait distribution: how long a player waited before
 * giving up, in these bands. `from` is inclusive, `to` exclusive (null: no
 * upper bound), both in whole seconds — the report's `by_wait` always holds all
 * of them, in this order, zeros included, so the axis is the same whatever the
 * data.
 */
export const QUEUE_ABANDON_WAIT_BANDS = [
  { key: 'under_30s', from: 0, to: 30 },
  { key: '30s_to_1m', from: 30, to: 60 },
  { key: '1m_to_2m', from: 60, to: 120 },
  { key: '2m_to_5m', from: 120, to: 300 },
  { key: '5m_to_10m', from: 300, to: 600 },
  { key: 'over_10m', from: 600, to: null },
] as const;

export type QueueAbandonWaitBand = (typeof QUEUE_ABANDON_WAIT_BANDS)[number]['key'];
