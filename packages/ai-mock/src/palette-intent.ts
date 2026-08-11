/**
 * Topic matching for the ⌘K palette's AI query (FR-MOD-01.1.3, `POST
 * /palette/ai-query`).
 *
 * The palette is account/team-wide and context-free — it has no chat to read
 * an intent from the way `detect_intent` does — so instead of one caller-named
 * intent it carries a small, fixed catalogue of topics the workspace can
 * actually answer from its own Overview report (ADR-09: the same report
 * builder `GET /reports/overview` uses, never a second computation of the same
 * number). Matching reuses `matchIntent`'s phrase-recall scoring against each
 * topic in turn and keeps the highest-scoring one — same lexical method, same
 * threshold, so "a single common word matching the wrong thing" is exactly as
 * unlikely here as it is for a skill.
 */
import { matchIntent, INTENT_THRESHOLD } from './intent.js';

export interface PaletteTopic {
  id: string;
  /** Dotted path into the Overview report body this topic answers from. */
  metricSource: string;
  phrases: string[];
}

/**
 * Deliberately small and specific. Each topic reads one number that already
 * exists on `GET /reports/overview` — adding a topic never means a new query,
 * only a new phrase list plus a reader for a field the report already returns.
 */
export const PALETTE_TOPICS: readonly PaletteTopic[] = [
  {
    id: 'team_activity',
    metricSource: 'totals.chats',
    // Deliberately not "how many chats": that phrase is a near-superset of the
    // automated/tickets topics' own phrasing ("chats resolved automatically"
    // shares both tokens) and would out-score them on a tie-break-by-order.
    phrases: ['team activity', 'summarize team', 'chats handled', 'conversations handled'],
  },
  {
    id: 'tickets',
    metricSource: 'totals.tickets',
    phrases: ['how many tickets', 'open tickets', 'ticket volume', 'tickets this period'],
  },
  {
    id: 'satisfaction',
    metricSource: 'satisfaction.score',
    phrases: [
      'customer satisfaction',
      'satisfaction score',
      'csat score',
      'how satisfied are customers',
    ],
  },
  {
    id: 'response_time',
    metricSource: 'response_times.avg_first_response_seconds',
    phrases: ['response time', 'first response time', 'how fast do we respond', 'reply speed'],
  },
  {
    id: 'automated',
    metricSource: 'totals.automated',
    phrases: [
      'automated resolutions',
      'ai resolutions',
      'chats resolved automatically',
      'bot resolved chats',
    ],
  },
] as const;

export interface PaletteTopicMatch {
  topic: PaletteTopic;
  score: number;
}

/** Same input, same output — no clock, no randomness, no external call. */
export function matchPaletteTopic(query: string): PaletteTopicMatch | null {
  let best: PaletteTopicMatch | null = null;

  for (const topic of PALETTE_TOPICS) {
    const result = matchIntent(query, topic.id, [...topic.phrases]);
    if (result.matched && (!best || result.score > best.score)) {
      best = { topic, score: result.score };
    }
  }

  return best;
}

export { INTENT_THRESHOLD as PALETTE_TOPIC_THRESHOLD };
