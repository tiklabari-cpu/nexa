/**
 * What both Copilot surfaces — the inbox panel and the drawer — suggest when a
 * report question lands nowhere (FR-EK-B.1).
 *
 * Shared so the two never offer different example questions: each phrase
 * resolves to a real metric in the BI dictionary, and a copy that drifted in
 * one surface would offer a question the other could not answer.
 */

/**
 * Example questions for the `not_understood` empty state (FR-EK-B.1).
 *
 * `apps/web` is deliberately decoupled from `@siyahtus/ai-mock` (the same split
 * `templates.test.ts` documents for skill steps), so these are not imported —
 * each phrase is copied verbatim from a `BI_METRICS` entry in
 * `packages/ai-mock/src/bi-intent.ts`, so clicking one is guaranteed to
 * resolve to a real metric rather than a guess. Keep in sync by hand if that
 * dictionary changes.
 */
export const BI_EXAMPLE_QUESTIONS: readonly string[] = [
  'How many chats started this week?',
  'How many chats closed this week?',
  'How many chats were resolved automatically today?',
  "What's the customer satisfaction score this month?",
];

/**
 * One canonical phrase per Overview field a `metric`/`no_data` answer can
 * name — the same source as {@link BI_EXAMPLE_QUESTIONS} — for the `no_data`
 * "try a wider window" suggestion.
 */
const BI_METRIC_PHRASE: Record<string, string> = {
  'totals.chats': 'how many chats started',
  'totals.closed': 'how many chats closed',
  'totals.manual': 'how many chats resolved manually',
  'totals.assisted': 'how many chats assisted',
  'totals.automated': 'how many chats resolved automatically',
  'satisfaction.score': 'customer satisfaction score',
};

/**
 * A fresh 30-day question for `metric` — never the original question text, so
 * a narrower window it may have named cannot linger in the new one.
 */
export function widenedBiQuestion(metric: string): string | null {
  const phrase = BI_METRIC_PHRASE[metric];
  if (!phrase) return null;
  return `${phrase[0]!.toUpperCase()}${phrase.slice(1)} in the last 30 days?`;
}
