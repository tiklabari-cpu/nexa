/**
 * Question → report metric, for Copilot's BI command (FR-MOD-12, `POST
 * /copilot/bi`).
 *
 * The chat-context counterpart to the palette's account-wide AI query
 * (`palette-intent.ts`). Both read a question and name a figure the workspace
 * can already answer from `GET /reports/overview` (ADR-09: Copilot never
 * computes its own number, so it can never disagree with Reports). This one
 * also has to answer *over what window*, which the palette does not — "how many
 * chats closed" and "how many chats closed yesterday" are different answers to
 * the same metric.
 *
 * Two ideas, borrowed from the two modules either side of it:
 *
 *   - the metric comes from `matchIntent`'s phrase-recall scoring against a
 *     small dictionary, one entry per figure on the Overview report — the same
 *     lexical method and the same threshold a skill's `detect_intent` uses;
 *   - the window comes from an ordered regex list, the `compiler.ts` shape,
 *     first pattern wins, most specific first.
 *
 * It resolves a *relative* window (`this_week`), never dates. That keeps the
 * module clock-free — same input, same output, forever — and leaves the caller,
 * which knows the request time, to turn it into the `{from,to}` the contract
 * returns.
 *
 * Deliberately unwilling to guess. A question this cannot place returns
 * `metric: null`, and so does a question that fits two metrics equally well:
 * a confident answer about the wrong figure is worse than "I don't know",
 * because nobody double-checks a number that arrived with a sentence around it.
 *
 * Pure — no Prisma, no Fastify, no network, no clock, no randomness.
 */
import { matchIntent, INTENT_THRESHOLD } from './intent.js';

/** A figure on `GET /reports/overview` this module can recognise a question about. */
export type MetricKey = 'chats' | 'closed' | 'manual' | 'assisted' | 'automated' | 'csat';

/**
 * A window named relative to "now", resolved to dates by the caller.
 *
 * Small on purpose: every member is a window the caller can compute without
 * ambiguity, and a phrasing outside this list yields `null` rather than a
 * near-miss. `null` means "the question named no window" — the caller applies
 * its own default (the report's last 30 days) and, per the contract, states the
 * window it used in the answer, so a window this module failed to read is
 * visible to the reader rather than silent.
 */
export type RelativeRange =
  'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_7_days' | 'last_30_days';

export interface BiMetric {
  key: MetricKey;
  /** Dotted path into the Overview report body the caller reads the figure from. */
  metricSource: string;
  /**
   * Phrases that mean this metric, in Turkish and English.
   *
   * Ordered longest-first, and it matters: `matchIntent` keeps the first phrase
   * reaching the best score, and the ranking below counts how many tokens that
   * phrase matched. When two phrases tie on score, the longer one is the better
   * evidence, so it has to be the one seen first. `orders phrases longest-first`
   * in the tests guards this.
   */
  phrases: string[];
}

/**
 * The metric dictionary — chats, closed, and the three-way resolution split
 * (PRD 07.3.2: manual + assisted + automated sum back to closed), plus
 * satisfaction.
 *
 * Note what is *not* here: no phrase claims the bare verb "çözüldü" /
 * "resolved" for a single metric, because that word is exactly what the three
 * split figures share. "Kaç sohbet çözüldü?" is a real question with three
 * defensible answers, and this returns none of them rather than picking one.
 */
export const BI_METRICS: readonly BiMetric[] = [
  {
    key: 'chats',
    metricSource: 'totals.chats',
    phrases: [
      'kaç sohbet başladı',
      'kaç konuşma başladı',
      'how many chats started',
      'toplam sohbet sayısı',
      'sohbet sayısı',
      'sohbet hacmi',
      'toplam sohbet',
      'how many chats',
      'total chats',
      'total conversations',
      'chat volume',
    ],
  },
  {
    key: 'closed',
    metricSource: 'totals.closed',
    phrases: [
      'kaç sohbet kapandı',
      'kaç sohbet kapatıldı',
      'kapanan sohbet sayısı',
      'how many chats closed',
      'sohbet kapandı',
      'kapanan sohbet',
      'kapanan konuşma',
      'chats closed',
      'closed conversations',
    ],
  },
  {
    key: 'manual',
    metricSource: 'totals.manual',
    phrases: [
      'kaç sohbet manuel çözüldü',
      'how many chats resolved manually',
      'manuel çözülen sohbet',
      'resolved by an agent',
      'manuel çözüm',
      'ajan çözdü',
      'manual resolutions',
      'manually resolved',
    ],
  },
  {
    key: 'assisted',
    metricSource: 'totals.assisted',
    phrases: [
      'kaç sohbet destekli çözüldü',
      'yapay zeka destekli çözüm',
      'how many chats assisted',
      'destekli çözüm',
      'copilot destekli',
      'assisted resolutions',
      'agent assisted',
    ],
  },
  {
    key: 'automated',
    metricSource: 'totals.automated',
    phrases: [
      'kaç sohbet otomatik çözüldü',
      'how many chats resolved automatically',
      'yapay zeka çözdü',
      'otomatik çözüm',
      'otomatik kapandı',
      'automated resolutions',
      'resolved automatically',
      'ai resolutions',
    ],
  },
  {
    key: 'csat',
    metricSource: 'satisfaction.score',
    phrases: [
      'müşteri memnuniyeti skoru',
      'customer satisfaction score',
      'müşteri memnuniyeti',
      'memnuniyet skoru',
      'customer satisfaction',
      'satisfaction score',
      'csat score',
      'csat',
    ],
  },
] as const;

export interface BiResolution {
  /** Null when nothing matched, and null when two metrics matched equally well. */
  metric: MetricKey | null;
  /** The window the question named, if any — independent of whether a metric matched. */
  range: RelativeRange | null;
  /**
   * How sure this is of `metric`, 0–1.
   *
   * Zero exactly when `metric` is null, ambiguity included: the only confidence
   * reported is confidence in the answer given, so no caller can branch on a
   * high score and reach for a metric that was never chosen.
   */
  confidence: number;
}

/**
 * Longer questions are truncated before any matching.
 *
 * The contract already caps `question` at 500 (400 above it), so this never
 * fires in the API; it is here because the module is exported on its own and a
 * pure function should not be a way to hand the process an unbounded string.
 * Every pattern below is a literal alternation with at most one quantifier and
 * no nesting — linear by construction — and the cap makes the cost constant
 * regardless, which is the regression the ReDoS test pins.
 */
const MAX_QUESTION_LENGTH = 500;

interface RangeMatcher {
  test: RegExp;
  range: RelativeRange;
}

/**
 * Order matters, most specific first — the `compiler.ts` convention.
 *
 * Turkish agglutinates, so the week/day words take a `\p{L}*` tail ("bu
 * haftaki", "son 7 günde"). "ay" does not get one: it is two letters and the
 * tail would swallow "bu ayrıca…", reading a month window out of a sentence
 * that named no window at all. A missed suffix costs a default window that the
 * answer names out loud; a false match costs a confident answer about the
 * wrong period.
 */
const RANGE_MATCHERS: readonly RangeMatcher[] = [
  { test: /\bdun(?:ku)?\b|\byesterday\b/u, range: 'yesterday' },
  { test: /\bbugun(?:ku)?\b|\btoday\b/u, range: 'today' },
  { test: /\bson (?:7|yedi) gun\p{L}*|\blast (?:7|seven) days?\b/u, range: 'last_7_days' },
  { test: /\bson (?:30|otuz) gun\p{L}*|\blast (?:30|thirty) days?\b/u, range: 'last_30_days' },
  { test: /\bgecen hafta\p{L}*|\blast week\b/u, range: 'last_week' },
  { test: /\bbu hafta\p{L}*|\bthis week\b/u, range: 'this_week' },
  { test: /\bbu ay\b|\bthis month\b/u, range: 'this_month' },
];

export function resolveBiQuestion(question: string): BiResolution {
  const text = question.slice(0, MAX_QUESTION_LENGTH);
  const range = matchRange(text);

  interface Candidate {
    key: MetricKey;
    score: number;
    /** Phrase tokens actually found — how much evidence, not just what share. */
    hits: number;
  }

  let best: Candidate | null = null;
  let ambiguous = false;

  for (const metric of BI_METRICS) {
    const result = matchIntent(text, metric.key, [...metric.phrases]);
    if (!result.matched) continue;

    const candidate: Candidate = { key: metric.key, score: result.score, hits: result.hits.length };

    if (!best || isStronger(candidate, best)) {
      best = candidate;
      ambiguous = false;
    } else if (candidate.hits === best.hits && candidate.score === best.score) {
      // Same words matched, same share of the phrase behind them — nothing left
      // to prefer one by. Asking "manual or automated?" is a question about two
      // metrics, and answering with either is a coin flip dressed up as a
      // report.
      ambiguous = true;
    }
  }

  if (!best || ambiguous) return { metric: null, range, confidence: 0 };
  return { metric: best.key, range, confidence: best.score };
}

/** The report field a metric is read from, e.g. `closed` → `totals.closed`. */
export function biMetricSource(key: MetricKey): string {
  return BI_METRICS.find((metric) => metric.key === key)!.metricSource;
}

/**
 * The metric that explains more of the question wins; recall breaks ties
 * between equally-evidenced matches.
 *
 * Evidence first, because a short phrase is a subset of a longer one and would
 * otherwise always win on share alone: "how many chats" is contained in "how
 * many chats resolved manually", so "how many chats were resolved" scores a
 * perfect 1 for total chats and a mere 0.75 for each split — and total chats is
 * not what was asked. Counting matched words instead puts the two splits level
 * at three, which is the honest reading: the question is about resolutions and
 * does not say which. Both candidates have already cleared the threshold, so
 * this only ever chooses between plausible readings.
 */
function isStronger(
  candidate: { score: number; hits: number },
  best: { score: number; hits: number },
): boolean {
  if (candidate.hits !== best.hits) return candidate.hits > best.hits;
  return candidate.score > best.score;
}

function matchRange(question: string): RelativeRange | null {
  const text = fold(question);
  for (const matcher of RANGE_MATCHERS) {
    if (matcher.test.test(text)) return matcher.range;
  }
  return null;
}

/**
 * Lowercase and strip diacritics, so "SON 7 GÜN" and "son 7 gun" are one
 * phrase.
 *
 * The same folding `tokenize` does, but the patterns cannot run on tokens:
 * tokenize drops single characters and stop words, which is most of a date
 * expression — "son 7 gün" loses the 7, "bu hafta" survives only by accident.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
}

export { INTENT_THRESHOLD as BI_CONFIDENCE_THRESHOLD };
